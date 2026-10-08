import { useEffect, useRef } from "react"

/**
 * While `active`, Escape runs `onEscape` and goes no further: a popover or overlay inside a Dialog closes alone,
 * where the Dialog's own listener would otherwise close the whole stack. It listens in the capture phase so it
 * hears Escape before the Dialog's `document` listener does, wherever focus is.
 */
export const useEscapeClaim = (active: boolean, onEscape: () => void) => {
	const latest = useRef(onEscape)
	useEffect(() => {
		latest.current = onEscape
	})

	useEffect(() => {
		if (!active) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			event.preventDefault()
			event.stopPropagation()
			latest.current()
		}
		document.addEventListener("keydown", onKeyDown, true)
		return () => document.removeEventListener("keydown", onKeyDown, true)
	}, [active])
}
