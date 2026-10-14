import { useSyncExternalStore } from "react"

import { PREVIEW_MIN_VIEWPORT } from "@/routes/paths"

const subscribe = (onChange: () => void) => {
	window.addEventListener("resize", onChange)
	return () => window.removeEventListener("resize", onChange)
}

/** The window is wide enough to show the content window beside a list; below it, a click opens the full page. */
export const canPreview = () => window.innerWidth >= PREVIEW_MIN_VIEWPORT

/** `canPreview`, kept current as the window resizes. */
export const useCanPreview = () => useSyncExternalStore(subscribe, canPreview, () => true)
