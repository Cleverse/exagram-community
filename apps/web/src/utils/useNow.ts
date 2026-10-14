import { useSyncExternalStore } from "react"

const MINUTE = 60_000

/**
 * One clock for the whole app: every screen that reads it sees the same instant, so the Context sidebar and
 * page never disagree about which day it is. It ticks every minute and when the window regains focus while
 * anything is subscribed, and `tickNow()` moves it on demand (a rebuild does).
 */
let current = new Date()
const listeners = new Set<() => void>()
let timer: number | null = null

const emit = () => {
	current = new Date()
	for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
	listeners.add(listener)
	if (listeners.size === 1) {
		// Catch up on whatever passed while nothing was listening.
		current = new Date()
		timer = window.setInterval(emit, MINUTE)
		window.addEventListener("focus", emit)
	}
	return () => {
		listeners.delete(listener)
		if (listeners.size === 0) {
			if (timer !== null) window.clearInterval(timer)
			timer = null
			window.removeEventListener("focus", emit)
		}
	}
}

/** Moves the shared clock to now and tells every reader. */
export const tickNow = () => emit()

/** The current time for labels that depend on the day ("Today", "Yesterday", a rolling week). */
export const useNow = (): Date =>
	useSyncExternalStore(
		subscribe,
		() => current,
		() => current,
	)
