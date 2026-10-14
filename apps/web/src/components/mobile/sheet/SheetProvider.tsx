import {
	type ComponentType,
	lazy,
	type LazyExoticComponent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { useLocation } from "react-router"

import { type SheetApi, SheetApiContext, type SheetFrame, SheetFrameContext } from "./context"
import { afterLayersClosed, useBackCloses } from "./history"
import { SHEETS, type SheetLoader } from "./registry"
import { Sheet } from "./Sheet"
import { type SheetEntry, type SheetKind, type SheetParams } from "./types"

import { trapTab } from "@/components/mobile/focusTrap"

/** A drawer opens over 340ms on the arrival curve and closes over 220ms, accelerating out. */
export const SHEET_OPEN_MS = 340
export const SHEET_CLOSE_MS = 220
/** A header dragged past 90px closes the drawer; short of that it springs back over 260ms. */
export const SHEET_DRAG_CLOSE_PX = 90
const DRAG_SPRING_MS = 260
/** The prototype's drag-out: quicker than a tap's close, the finger has already moved it part way. */
const DRAG_OUT_MS = 200
/** A short drag still closes when it was quick: px per ms from press to release, iOS-like. */
const SHEET_FLICK_PX_PER_MS = 0.11
/** Below this a release is a tap or a twitch, however fast. */
const SHEET_FLICK_MIN_PX = 10

const reducedMotion = () =>
	typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

const Unavailable = () => (
	<Sheet title="Not available here yet">
		<div style={{ padding: "4px 16px 12px", fontSize: 14, color: "var(--color-muted)" }}>
			Open Exagram on a computer to do this.
		</div>
	</Sheet>
)

/**
 * The one bottom drawer the mobile shell hosts, and `useSheet()` for opening it. A drawer is looked up by kind
 * in `SHEETS` and loaded on first use; `sheets` swaps the lookup in tests.
 */
export const SheetProvider = ({
	children,
	sheets = SHEETS,
}: {
	children: ReactNode
	sheets?: Map<SheetKind, SheetLoader> | undefined
}) => {
	const [stack, setStack] = useState<SheetEntry[]>([])
	const [closing, setClosing] = useState(false)
	const nextKey = useRef(0)
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const opener = useRef<HTMLElement | null>(null)
	const dialogRef = useRef<HTMLDivElement>(null)
	const scrimRef = useRef<HTMLDivElement>(null)
	const endDrag = useRef<(() => void) | null>(null)
	const lazyCache = useRef(new Map<SheetKind, LazyExoticComponent<ComponentType<{ params: never }>>>())
	const location = useLocation()

	const clearTimer = () => {
		if (closeTimer.current !== null) clearTimeout(closeTimer.current)
		closeTimer.current = null
	}

	const finishClose = useCallback(() => {
		clearTimer()
		setStack([])
		setClosing(false)
	}, [])

	const close = useCallback(() => {
		if (reducedMotion()) {
			finishClose()
			return
		}
		setClosing(true)
		clearTimer()
		closeTimer.current = setTimeout(finishClose, SHEET_CLOSE_MS)
	}, [finishClose])

	const entry = <K extends SheetKind>(kind: K, params: SheetParams[K]) =>
		({ kind, params, key: nextKey.current++ }) as SheetEntry

	const depth = useRef(0)
	depth.current = stack.length

	const open = useCallback<SheetApi["open"]>((kind, params) => {
		clearTimer()
		setClosing(false)
		if (depth.current === 0 && document.activeElement instanceof HTMLElement) opener.current = document.activeElement
		setStack([entry(kind, params)])
	}, [])

	const push = useCallback<SheetApi["push"]>((kind, params) => {
		setStack((previous) => [...previous, entry(kind, params)])
	}, [])

	const back = useCallback(() => {
		if (depth.current > 1) setStack((previous) => previous.slice(0, -1))
		else close()
	}, [close])

	// A drawer that navigates (Open, a Project link) should not stay over the next screen.
	const pathname = location.pathname
	const lastPathname = useRef(pathname)
	useEffect(() => {
		if (lastPathname.current === pathname) return
		lastPathname.current = pathname
		clearTimer()
		setStack([])
		setClosing(false)
		opener.current = null
	}, [pathname])

	const isOpen = stack.length > 0
	// Back closes the drawer rather than the screen under it; the entry goes as soon as the close starts.
	useBackCloses(isOpen && !closing, close)

	useEffect(() => {
		if (!isOpen) return
		dialogRef.current?.focus()
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") back()
			else if (event.key === "Tab" && dialogRef.current) trapTab(dialogRef.current, event)
		}
		const onFocusIn = (event: FocusEvent) => {
			const dialog = dialogRef.current
			if (dialog && event.target instanceof Node && !dialog.contains(event.target)) dialog.focus()
		}
		document.addEventListener("keydown", onKey)
		document.addEventListener("focusin", onFocusIn)
		return () => {
			document.removeEventListener("keydown", onKey)
			document.removeEventListener("focusin", onFocusIn)
			// Focus goes back once the drawer is gone, so the trap above cannot pull it in again.
			opener.current?.focus()
			opener.current = null
		}
	}, [isOpen, back])

	/**
	 * Dragging the header down: the drawer follows the finger and the scrim
	 * fades with it; let go past 90px, or flick it, and it slides out, otherwise it springs back. The drag writes styles
	 * straight to the two elements so a finger's every move costs no render. Buttons in the header (Back, ×)
	 * keep their tap.
	 */
	const onDragStart = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const sheet = dialogRef.current
			if (!sheet || event.button !== 0) return
			if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select")) return
			endDrag.current?.()
			const scrim = scrimRef.current
			const startY = event.clientY
			const startedAt = Date.now()
			let dy = 0
			sheet.style.transition = "none"
			sheet.style.animation = "none"
			if (scrim) {
				scrim.style.transition = "none"
				scrim.style.animation = "none"
			}
			const move = (moveEvent: PointerEvent) => {
				dy = Math.max(0, moveEvent.clientY - startY)
				sheet.style.transform = `translateY(${dy}px)`
				if (scrim) scrim.style.opacity = String(Math.max(0, 1 - dy / 400))
			}
			const stop = () => {
				window.removeEventListener("pointermove", move)
				window.removeEventListener("pointerup", release)
				window.removeEventListener("pointercancel", release)
				endDrag.current = null
			}
			const release = () => {
				stop()
				const still = reducedMotion()
				const elapsed = Math.max(1, Date.now() - startedAt)
				const flicked = dy > SHEET_FLICK_MIN_PX && dy / elapsed > SHEET_FLICK_PX_PER_MS
				if (dy > SHEET_DRAG_CLOSE_PX || flicked) {
					if (still) {
						finishClose()
						return
					}
					sheet.style.transition = `transform ${DRAG_OUT_MS}ms cubic-bezier(.4,0,1,1)`
					sheet.style.transform = "translateY(100%)"
					if (scrim) {
						scrim.style.transition = `opacity ${DRAG_OUT_MS}ms`
						scrim.style.opacity = "0"
					}
					clearTimer()
					closeTimer.current = setTimeout(finishClose, DRAG_OUT_MS)
					return
				}
				sheet.style.transition = still ? "none" : `transform ${DRAG_SPRING_MS}ms var(--ease-arrive)`
				sheet.style.transform = ""
				if (scrim) {
					scrim.style.transition = still ? "none" : `opacity ${DRAG_SPRING_MS}ms`
					scrim.style.opacity = ""
				}
			}
			window.addEventListener("pointermove", move)
			window.addEventListener("pointerup", release)
			window.addEventListener("pointercancel", release)
			endDrag.current = stop
		},
		[finishClose],
	)

	useEffect(
		() => () => {
			clearTimer()
			endDrag.current?.()
		},
		[],
	)

	const closeThen = useCallback(
		(then: () => void) => {
			close()
			afterLayersClosed(then)
		},
		[close],
	)

	const api = useMemo<SheetApi>(() => ({ open, push, back, close, closeThen }), [open, push, back, close, closeThen])

	const top = stack.at(-1)
	const titleId = "m-sheet-title"
	const frame = useMemo<SheetFrame>(
		() => ({ depth: stack.length, back, close, titleId, dragHandleProps: { onPointerDown: onDragStart } }),
		[stack.length, back, close, onDragStart],
	)

	let Body: ComponentType<{ params: never }> = Unavailable
	if (top) {
		const load = sheets.get(top.kind)
		if (load) {
			let cached = lazyCache.current.get(top.kind)
			if (!cached) {
				cached = lazy(load)
				lazyCache.current.set(top.kind, cached)
			}
			Body = cached
		}
	}

	return (
		<SheetApiContext.Provider value={api}>
			{children}
			{top ? (
				<>
					<div
						ref={scrimRef}
						aria-hidden
						data-testid="sheet-scrim"
						onClick={close}
						className="fixed inset-0"
						style={{
							zIndex: 88,
							background: "var(--color-scrim)",
							animation: closing ? `m-fade-out ${SHEET_CLOSE_MS}ms forwards` : "m-fade-in 260ms",
						}}
					/>
					<div
						ref={dialogRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby={titleId}
						tabIndex={-1}
						className="fixed flex flex-col bg-white outline-none"
						style={{
							left: 0,
							right: 0,
							bottom: 0,
							zIndex: 89,
							maxHeight: "calc(100dvh - 64px)",
							borderRadius: "12px 12px 0 0",
							boxShadow: "0 -12px 40px rgba(23,25,35,.18)",
							paddingBottom: "max(16px, env(safe-area-inset-bottom))",
							pointerEvents: closing ? "none" : undefined,
							animation: closing
								? `m-sheet-out ${SHEET_CLOSE_MS}ms cubic-bezier(.4,0,1,1) forwards`
								: `m-sheet-in ${SHEET_OPEN_MS}ms var(--ease-arrive)`,
						}}
					>
						<SheetFrameContext.Provider value={frame}>
							<Suspense fallback={<div style={{ height: 120 }} />}>
								<Body key={top.key} params={top.params as never} />
							</Suspense>
						</SheetFrameContext.Provider>
					</div>
				</>
			) : null}
		</SheetApiContext.Provider>
	)
}
