import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useState } from "react"
import { useLocation } from "react-router"

import { useSidebarWidth } from "@/components/sidebar/sidebarWidth"

const STORAGE_KEY = "exagram.listWidth"
/** The list column beside an open pane (T:L4516): 400px until dragged, never under 300px. */
export const LIST_DEFAULT_WIDTH = 400
export const LIST_MIN_WIDTH = 300
/** The pane never gets narrower than this (v3 README §3), so the drag stops short of it. */
export const PANE_MIN_WIDTH = 360
/** The Comments / Ledger `SidePanel` shrinks, but never under this (`min-w-80`). */
export const SIDE_PANEL_MIN_WIDTH = 320

/**
 * The pane's minimum for the side panel named by `?panel=`: 360px, plus the Comments / Ledger panel's 320
 * while one is open, so the document beside it keeps its own 360px rather than the few dozen pixels that
 * would be left. History is a modal (v3.6 §3) and takes nothing from the pane.
 */
export const paneMinWidth = (panel: string | null) =>
	PANE_MIN_WIDTH + (panel === "comments" || panel === "ledger" ? SIDE_PANEL_MIN_WIDTH : 0)

/**
 * The widest the list may be: whatever the sidebar (full or the rail) and the pane's minimum leave. When
 * there isn't even that much room, the list's 300px wins and the pane keeps its own minimum beside it.
 */
const maxFor = (viewportWidth: number, sidebarWidth: number, paneMin: number) =>
	Math.max(LIST_MIN_WIDTH, viewportWidth - sidebarWidth - paneMin)

const clamp = (value: number, max: number) => Math.min(max, Math.max(LIST_MIN_WIDTH, Math.round(value)))

const readStored = (): number => {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY)
		const value = raw === null ? Number.NaN : Number(raw)
		return Number.isFinite(value) ? value : LIST_DEFAULT_WIDTH
	} catch {
		return LIST_DEFAULT_WIDTH
	}
}

const writeStored = (value: number) => {
	try {
		window.localStorage.setItem(STORAGE_KEY, String(value))
	} catch {
		// Private windows may refuse; the width then lives for the session only.
	}
}

/**
 * The list column's width while the preview pane is open, dragged from the pane's left edge. The pane
 * takes the rest (`flex:1`, uncapped), which is the prototype's model: the list is sized, the pane
 * fills.
 *
 * Two widths: `preferred` is what the reader chose and what is remembered; `width` is that clamped to the
 * room there is right now. A narrow window or an expanded sidebar squeezes what is shown without
 * forgetting the choice, and only a finished drag or a keyboard nudge writes it to storage. `dragging`
 * lets the pane switch the iframe's pointer events off while the handle is held, since an iframe would
 * otherwise swallow the moves. `?panel=` (History, Comments or the Ledger beside the document) raises the
 * pane's minimum, so the list gives way to it first.
 */
export const useListWidth = () => {
	const sidebarWidth = useSidebarWidth()
	const paneMin = paneMinWidth(new URLSearchParams(useLocation().search).get("panel"))
	const [preferred, setPreferred] = useState(readStored)
	const [viewport, setViewport] = useState(() => window.innerWidth)
	const [dragging, setDragging] = useState(false)

	useEffect(() => {
		const onResize = () => setViewport(window.innerWidth)
		window.addEventListener("resize", onResize)
		return () => window.removeEventListener("resize", onResize)
	}, [])

	// Kept in state so the handle's `aria-valuemax` and the shown width follow a window resize.
	const max = maxFor(viewport, sidebarWidth, paneMin)
	const width = clamp(preferred, max)

	const startDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			if (event.button !== 0) return
			event.preventDefault()
			const handle = event.currentTarget
			handle.setPointerCapture(event.pointerId)
			setDragging(true)
			let latest: number | null = null

			// The handle sits on the list's right edge, so the pointer's x less the sidebar is the list width.
			const onMove = (move: PointerEvent) => {
				latest = clamp(move.clientX - sidebarWidth, maxFor(window.innerWidth, sidebarWidth, paneMin))
				setPreferred(latest)
			}
			const stop = () => {
				handle.removeEventListener("pointermove", onMove)
				handle.removeEventListener("pointerup", stop)
				handle.removeEventListener("pointercancel", stop)
				setDragging(false)
				// Only the width the drag ended on is remembered, never every step along the way.
				if (latest !== null) writeStored(latest)
			}
			handle.addEventListener("pointermove", onMove)
			handle.addEventListener("pointerup", stop)
			handle.addEventListener("pointercancel", stop)
		},
		[sidebarWidth, paneMin],
	)

	const nudge = useCallback(
		(delta: number) => {
			const next = clamp(width + delta, max)
			setPreferred(next)
			writeStored(next)
		},
		[width, max],
	)

	return { width, preferred, max, dragging, startDrag, nudge }
}

export type ListWidth = ReturnType<typeof useListWidth>
