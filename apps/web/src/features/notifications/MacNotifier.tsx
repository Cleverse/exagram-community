import { type LiveTopic } from "@exagram/api-client"
import { useEffect, useRef } from "react"

import { apiClient } from "@/config/apiClient"
import { API_ORIGIN } from "@/config/env"
import { useMe } from "@/features/auth/hooks/useMe"
import { useLiveEvent } from "@/features/live/LiveEventsProvider"
import { type MacBridge, macBridge } from "@/features/notifications/macBridge"
import {
	firstState,
	loadState,
	MAX_PAGES,
	planNotifications,
	saveState,
	sinceFor,
	stateKey,
} from "@/features/notifications/notificationPlan"

/** Signals coalesce for this long before one fetch, so a burst of events is one request. */
export const NOTIFY_DEBOUNCE_MS = 1_500

/** The topics that can mean a new Notification; `resync` opens every stream, so a reconnect catches up. */
const NOTIFY_TOPICS: ReadonlySet<LiveTopic> = new Set(["accessRequests", "revisions", "reach", "comments", "resync"])

const browserStorage = (): Storage | null => {
	try {
		return window.localStorage
	} catch {
		return null
	}
}

/**
 * Inside the Mac app (bridge version 2), asks `GET /v1/notifications` what is new whenever a live signal could mean
 * something for this member, and once on mount, and hands each new item to the app to post. Debounced, one
 * request in flight; a signal during a request causes one more after it. Mount it inside `LiveEventsProvider`.
 */
export const MacNotifier = ({
	bridge = macBridge(),
	client = apiClient,
	server = API_ORIGIN,
	storage = browserStorage(),
}: {
	/** Injectable for tests. */
	bridge?: MacBridge | null
	client?: Pick<typeof apiClient, "notifications">
	server?: string
	storage?: Storage | null
}) => {
	const me = useMe().data
	const userId = me?.id
	const workspaceId = me?.workspaceId
	const schedule = useRef<() => void>(() => undefined)
	// Read once: the defaults are rebuilt every render, and a re-render must not restart the notifier.
	const options = useRef({ bridge, client, server, storage })

	useEffect(() => {
		const { bridge, client, server, storage } = options.current
		const notify = bridge?.notify
		if (userId === undefined || workspaceId === undefined || notify === undefined || storage === null) return
		const key = stateKey(server, userId, workspaceId)
		let stopped = false
		let timer: ReturnType<typeof setTimeout> | null = null
		let inFlight = false
		let again = false

		const check = async () => {
			const state = loadState(storage, key)
			if (state === null) {
				const answer = await client.notifications.list()
				if (!stopped) saveState(storage, key, firstState(answer.serverTime))
				return
			}
			// Read on while a page comes back full, so a busy stretch never stalls the cursor; past MAX_PAGES the
			// rest waits for the next check, which starts from the cursor these pages moved.
			let answer = await client.notifications.list({ since: sinceFor(state) })
			const items = [...answer.items]
			for (let page = 1; page < MAX_PAGES && answer.next !== null && !stopped; page += 1) {
				answer = await client.notifications.list({ after: answer.next })
				items.push(...answer.items)
			}
			if (stopped) return
			const plan = planNotifications(state, items)
			saveState(storage, key, plan.state)
			for (const notice of plan.notices) notify(notice)
		}

		const run = async () => {
			timer = null
			inFlight = true
			try {
				await check()
			} catch {
				// Offline or refused: the cursor stays, so the next signal asks again from the same place.
			} finally {
				inFlight = false
			}
			if (again && !stopped) {
				again = false
				schedule.current()
			}
		}

		schedule.current = () => {
			if (inFlight) {
				again = true
				return
			}
			if (timer !== null) clearTimeout(timer)
			timer = setTimeout(() => void run(), NOTIFY_DEBOUNCE_MS)
		}
		schedule.current()

		return () => {
			stopped = true
			if (timer !== null) clearTimeout(timer)
			schedule.current = () => undefined
		}
	}, [userId, workspaceId])

	useLiveEvent((event) => {
		if (NOTIFY_TOPICS.has(event.topic)) schedule.current()
	})

	return null
}
