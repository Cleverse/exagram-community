import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef } from "react"

import { IconButton } from "@/components/ui/IconButton"
import { IconClose } from "@/components/ui/icons"

const OPEN_DIALOGS = '[role="dialog"][aria-modal="true"]'
const TAB_STOPS =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const isTopmost = (dialog: HTMLElement) => {
	const open = document.querySelectorAll(OPEN_DIALOGS)
	return open[open.length - 1] === dialog
}

const isRadio = (element: HTMLElement): element is HTMLInputElement =>
	element instanceof HTMLInputElement && element.type === "radio"

const tabStopsIn = (dialog: HTMLElement) => {
	const stops = [...dialog.querySelectorAll<HTMLElement>(TAB_STOPS)].filter((stop) => !stop.closest("[hidden]"))
	const groupsWithAChoice = new Set(
		stops
			.filter(isRadio)
			.filter((radio) => radio.checked && radio.name !== "")
			.map((radio) => radio.name),
	)
	return stops.filter((stop) => !(isRadio(stop) && !stop.checked && groupsWithAChoice.has(stop.name)))
}

const useFocusTrap = (dialogRef: RefObject<HTMLDivElement | null>) => {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const dialog = dialogRef.current
			if (event.key !== "Tab" || !dialog || !isTopmost(dialog)) return
			const active = document.activeElement
			const focusLost = active === null || active === document.body
			const focusHeldOutsideTheDialog = !focusLost && !dialog.contains(active)
			if (focusHeldOutsideTheDialog) return
			const stops = tabStopsIn(dialog)
			const first = stops[0]
			const last = stops[stops.length - 1]
			if (!first || !last) {
				event.preventDefault()
				dialog.focus()
				return
			}
			if (event.shiftKey ? focusLost || active === first || active === dialog : focusLost || active === last) {
				event.preventDefault()
				;(event.shiftKey ? last : first).focus()
			}
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [dialogRef])
}

/**
 * The dialog shell every dialog shares (T:L3404–3458, the NEW / EDIT PROJECT chrome): an ink scrim, a
 * card on `surface-dialog` with a `line-soft` hairline, the 10px `--radius-dialog` and `--shadow-dialog`, sticky header and footer, `fadeUp` entrance.
 * `ariaLabel` overrides the accessible name when `title` is not a plain string.
 */
export const Dialog = ({
	title,
	ariaLabel,
	onClose,
	width = 680,
	scrim = 0.45,
	surface = "var(--color-surface-dialog)",
	header,
	headerPadding = "20px 24px",
	titleSize = 18,
	footer,
	helper,
	bare = false,
	bodyGap = 28,
	bodyPadding = 24,
	cardStyle,
	children,
}: {
	title?: ReactNode
	ariaLabel?: string
	onClose: () => void
	/** max-width in px. 560 recap, 680 project settings, 730 Share, 760 client detail. */
	width?: number
	/** Scrim opacity over ink, .14 (light) to .55 (client detail). */
	scrim?: number
	/** Card background. `var(--color-surface)` or `var(--color-ground-raised)` for the form dialogs, `#fff` for the recap modal. */
	surface?: string
	/** Replaces the whole sticky header, title and close button included. */
	header?: ReactNode
	/** `20px 22px` in the recap modal. */
	headerPadding?: number | string
	/** Geist 600; 18px by default. */
	titleSize?: number
	footer?: ReactNode
	/** Footer left-hand text, 13px `var(--color-muted)`. */
	helper?: ReactNode
	/** Drops the padded body wrapper so children sit flush to the card edges. */
	bare?: boolean
	bodyGap?: number
	bodyPadding?: number | string
	/** Escape hatch for a card the Screen 2 chrome cannot express — Share uses it for `overflow:hidden`. */
	cardStyle?: CSSProperties
	children: ReactNode
}) => {
	const dialogRef = useRef<HTMLDivElement>(null)

	// Focus once on open. Callers pass inline `onClose`s, so an effect keyed on it would re-run on every
	// parent render and pull focus out of whatever field inside the dialog the reader is typing in.
	// A child's `autoFocus` has already run by now; only take focus when nothing inside holds it.
	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.contains(document.activeElement)) dialog.focus()
	}, [])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			// Only the topmost dialog closes, so Compare over Revision history leaves the history open.
			const open = document.querySelectorAll(OPEN_DIALOGS)
			if (open.length > 0 && open[open.length - 1] !== dialogRef.current) return
			// Claimed, so a window-level Escape (the preview's full view, the pane) leaves it alone.
			event.preventDefault()
			onClose()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [onClose])

	useFocusTrap(dialogRef)

	const sticky: CSSProperties = { position: "sticky", background: surface, zIndex: 1 }

	return (
		<div
			className="fixed inset-0 grid place-items-center"
			style={{
				background: `color-mix(in srgb, var(--color-ink) ${scrim * 100}%, transparent)`,
				zIndex: 50,
				padding: 24,
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose()
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
				tabIndex={-1}
				className="w-full outline-none"
				style={{
					maxWidth: width,
					maxHeight: "calc(100vh - 48px)",
					overflow: "auto",
					background: surface,
					border: "1px solid var(--color-line-soft)",
					borderRadius: "var(--radius-dialog)",
					boxShadow: "var(--shadow-dialog)",
					animation: "fadeUp var(--duration-panel) var(--ease-arrive)",
					...cardStyle,
				}}
			>
				{header ??
					(title === undefined ? null : (
						<div
							className="flex items-center"
							style={{
								...sticky,
								top: 0,
								gap: 12,
								padding: headerPadding,
								borderBottom: "1px solid var(--color-line)",
							}}
						>
							<h2 className="font-display min-w-0 truncate" style={{ fontWeight: 600, fontSize: titleSize }}>
								{title}
							</h2>
							<div className="flex-1" />
							<IconButton size={32} aria-label="Close" onClick={onClose}>
								<IconClose size={16} />
							</IconButton>
						</div>
					))}

				{bare ? (
					children
				) : (
					<div className="flex flex-col" style={{ gap: bodyGap, padding: bodyPadding }}>
						{children}
					</div>
				)}

				{footer || helper ? (
					<div
						className="flex items-center"
						style={{ ...sticky, bottom: 0, gap: 10, padding: "16px 24px", borderTop: "1px solid var(--color-line)" }}
					>
						<div className="min-w-0 flex-1" style={{ fontSize: 13, color: "var(--color-muted)" }}>
							{helper}
						</div>
						{footer}
					</div>
				) : null}
			</div>
		</div>
	)
}

/**
 * The dialog footer's Cancel / primary pair for a raw `<button>` (T:L3453–3454); prefer
 * `<Button variant="outline" | "primary" size={40}>`. The primary is black.
 */
export const dialogCancelClass =
	"press flex h-10 items-center border border-line-strong bg-white px-4 text-[15px] text-secondary hover:bg-surface"
export const dialogPrimaryClass =
	"press bg-primary text-white hover:bg-primary-hover flex h-10 items-center px-[18px] text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
