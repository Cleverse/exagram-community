/** Anything Tab can land on inside a modal layer. */
const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Tab and Shift+Tab wrap inside `container`: the bottom drawer and the nav drawer are modal, so nothing behind
 * the scrim takes focus. Call from a `keydown` handler for the Tab key.
 */
export const trapTab = (container: HTMLElement, event: KeyboardEvent) => {
	const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]
	const first = focusable[0]
	const last = focusable.at(-1)
	const active = document.activeElement
	const inside = active instanceof Node && active !== container && container.contains(active)
	if (!first || !last) {
		event.preventDefault()
		container.focus()
	} else if (event.shiftKey && (!inside || active === first)) {
		event.preventDefault()
		last.focus()
	} else if (!event.shiftKey && (!inside || active === last)) {
		event.preventDefault()
		first.focus()
	}
}
