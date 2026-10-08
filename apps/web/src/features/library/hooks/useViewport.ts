import { useSyncExternalStore } from "react"

import { TALL_VIEWPORT } from "@/features/library/pageHeader"

export type Viewport = { width: number; height: number }

/** From this width the docked preview pane has room for its Present button. */
export const PRESENT_IN_PANE_MIN_WIDTH = 1800

const subscribe = (onChange: () => void) => {
	window.addEventListener("resize", onChange)
	return () => window.removeEventListener("resize", onChange)
}

const current = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight })

/**
 * One fact about the window, kept current as it resizes. `read` returns a primitive, so a resize that does not
 * change the answer does not re-render.
 */
const useViewport = <T extends boolean | number>(read: (viewport: Viewport) => T, server: T): T =>
	useSyncExternalStore(
		subscribe,
		() => read(current()),
		() => server,
	)

export const useTallViewport = () => useViewport(({ height }) => height >= TALL_VIEWPORT, true)

export const usePresentFitsPane = () => useViewport(({ width }) => width >= PRESENT_IN_PANE_MIN_WIDTH, false)
