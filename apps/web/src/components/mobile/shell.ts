import { useSyncExternalStore } from "react"

/**
 * Below this width the app draws the mobile web screens instead of the desktop
 * ones. The decision is the window's width alone, so a narrowed desktop window gets the phone layout too.
 */
export const MOBILE_QUERY = "(max-width: 767px)"

export type Shell = "mobile" | "desktop"

const query = () => (typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_QUERY) : null)

export const currentShell = (): Shell => (query()?.matches ? "mobile" : "desktop")

const subscribe = (onChange: () => void) => {
	const list = query()
	if (!list) return () => {}
	list.addEventListener("change", onChange)
	return () => list.removeEventListener("change", onChange)
}

/** Which layout this window draws; re-renders when the window crosses the breakpoint. */
export const useShell = (): Shell => useSyncExternalStore(subscribe, currentShell, () => "desktop")

/**
 * `data-shell` on `<html>` scopes the desktop-only CSS (the 880px minimum width) so a phone never scrolls
 * sideways. Set before the first render and kept in step with the breakpoint.
 */
export const syncShellAttribute = () => {
	const apply = () => {
		document.documentElement.dataset.shell = currentShell()
	}
	apply()
	return subscribe(apply)
}
