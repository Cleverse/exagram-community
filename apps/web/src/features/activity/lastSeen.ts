import { useEffect, useState, useSyncExternalStore } from "react"

import { type FeedEvent } from "@/features/activity/activityFeed"
import { forgetAtSessionBoundary } from "@/features/auth/sessionMemory"
import { dropUnscopedKey, useFrameSettled, useStateScope } from "@/features/workspace/stateScope"

const LAST_SEEN_KEY = "exagram.activity.lastSeen"
const DAY_MS = 86_400_000

const keyFor = (scope: string) => `${LAST_SEEN_KEY}.${scope}`

dropUnscopedKey(LAST_SEEN_KEY)

const read = (scope: string): number => {
	try {
		const stored = Number(window.localStorage.getItem(keyFor(scope)))
		return Number.isFinite(stored) ? stored : 0
	} catch {
		return 0
	}
}

// Held here as well as in storage, so marking read still clears the badge when storage is off.
const marks = new Map<string, number>()
const listeners = new Set<() => void>()
forgetAtSessionBoundary(() => marks.clear())

const markOf = (scope: string): number => {
	let at = marks.get(scope)
	if (at === undefined) {
		at = read(scope)
		marks.set(scope, at)
	}
	return at
}

const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/**
 * When this person last looked at Activity in the Workspace the session acts in, epoch ms (0 before they ever
 * have). Only this browser knows: the API keeps no read state, so a second device starts with everything recent
 * unread.
 */
export const useLastSeen = () => {
	const scope = useStateScope()
	return useSyncExternalStore(subscribe, () => markOf(scope))
}

/** Leaving Activity or "Mark all read": everything in that person's Workspace up to `at` is read. */
export const markSeen = (scope: string, at: number = Date.now()) => {
	marks.set(scope, at)
	try {
		window.localStorage.setItem(keyFor(scope), String(at))
	} catch {
		// Storage can be off (private mode, blocked site data); the mark then lasts until the tab closes.
	}
	for (const listener of listeners) listener()
}

/**
 * Leaving the Activity screen reads it. A mount that never showed its Workspace does not: a switch lands on Activity
 * in the frame of the Workspace being left for one commit, and nobody looked at that.
 */
export const useMarkSeenOnLeave = () => {
	const scope = useStateScope()
	const [viewed] = useState(useFrameSettled())
	useEffect(
		() => () => {
			if (viewed) markSeen(scope)
		},
		[scope, viewed],
	)
}

/**
 * An unread row: someone else's publish in the last day that came after the last look.
 * A pending submission is not counted here: when it waits on this person it is already an approval.
 */
export const isUnread = (event: FeedEvent, lastSeen: number, now: Date) =>
	!event.mine && !event.pending && event.at > Math.max(lastSeen, now.getTime() - DAY_MS)
