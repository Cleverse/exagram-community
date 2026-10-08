export type Shortcut = "search" | "copyLink"

/**
 * The app's keyboard shortcuts, on ⌘ (macOS) or Ctrl (elsewhere): ⌘P or ⌘K opens search, ⌘L copies the page's
 * address. Each takes the browser's own binding (Print, the address bar), as Notion and Linear do. Shift or
 * Option held is another shortcut, left to the browser.
 */
export const shortcutOf = (event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">) => {
	if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return null
	const key = event.key.toLowerCase()
	if (key === "p" || key === "k") return "search"
	if (key === "l") return "copyLink"
	return null
}
