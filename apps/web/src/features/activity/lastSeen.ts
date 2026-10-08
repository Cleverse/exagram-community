import { useSyncExternalStore } from "react"

import { type FeedEvent } from "@/features/activity/activityFeed"

const LAST_SEEN_KEY = "exagram.activity.lastSeen"
const DAY_MS = 86_400_000

const read = (): number => {
	try {
		const stored = Number(window.localStorage.getItem(LAST_SEEN_KEY))
		return Number.isFinite(stored) ? stored : 0
	} catch {
		return 0
	}
}

// Held here as well as in storage, so marking read still clears the badge when storage is off.
let current = read()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/**
 * When this person last looked at Activity, epoch ms (0 before they ever have). Only this browser knows: the
 * API keeps no read state, so a second device starts with everything recent unread.
 */
export const useLastSeen = () => useSyncExternalStore(subscribe, () => current)

/** Leaving Activity or "Mark all read" (README §2): everything up to `at` is read. */
export const markSeen = (at: number = Date.now()) => {
	current = at
	try {
		window.localStorage.setItem(LAST_SEEN_KEY, String(at))
	} catch {
		// Storage can be off (private mode, blocked site data); the mark then lasts until the tab closes.
	}
	for (const listener of listeners) listener()
}

/**
 * An unread row (README §2, C:L785): someone else's publish in the last day that came after the last look.
 * A pending submission is not counted here: when it waits on this person it is already an approval.
 */
export const isUnread = (event: FeedEvent, lastSeen: number, now: Date) =>
	!event.mine && !event.pending && event.at > Math.max(lastSeen, now.getTime() - DAY_MS)
