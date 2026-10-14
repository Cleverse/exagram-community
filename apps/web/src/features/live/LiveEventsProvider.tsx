import { isApiError, type LiveEvent } from "@exagram/api-client"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react"

import { apiClient } from "@/config/apiClient"
import { idleOnly, type LiveInvalidation, planFor } from "@/features/live/liveKeys"
import { macNotifies } from "@/features/notifications/macBridge"

/** `live` while events (the 25 s `ping` included) keep arriving; anything else means pages keep their own polling. */
export type LiveStatus = "connecting" | "live" | "down"

type Listener = (event: LiveEvent) => void

type LiveContextValue = { status: LiveStatus; listeners: Set<Listener> }

const LiveContext = createContext<LiveContextValue>({ status: "down", listeners: new Set() })

export type Subscribe = (signal: AbortSignal) => Promise<AsyncIterable<LiveEvent>>

export const RETRY_MIN_MS = 1_000
export const RETRY_MAX_MS = 30_000
/** Keys shared across Artifacts (the Library's lists, the approvals inbox) refetch at most this often. */
export const LIBRARY_DEBOUNCE_MS = 1_000
/** No event for this long (the server pings every 25 s) means a half-open stream: drop it and reconnect. */
export const STALL_MS = 60_000
/** A tab hidden this long closes its stream; a quick switch away keeps it, and needs no resync. */
export const HIDDEN_GRACE_MS = 30_000
/** A stream open this long counts as a success, so the next reconnect starts from the shortest wait. */
export const STABLE_MS = 10_000
/** Allowance for the time a commit's notice takes to reach the api's feed, when trusting its opening `quietMs`. */
export const QUIET_MARGIN_MS = 2_000

/**
 * The first stream's opening `resync` reports nothing new only if the workspace has been quiet since before this
 * page began loading (`performance.now()` counts from navigation), with a margin for notify latency. A server
 * that sends no `quietMs`, or a quiet that began after the page did, may be reporting a change that landed
 * between the page's initial fetch and the stream's subscription, so it is honoured.
 */
const quietSincePageLoad = (event: LiveEvent, now: number = performance.now()): boolean =>
	event.quietMs !== undefined && event.quietMs > now + QUIET_MARGIN_MS

/** 1 s, 2 s, 4 s … capped at 30 s, each up to 30% longer so tabs that lost the stream together spread out. */
export const retryDelay = (attempt: number, random: () => number = Math.random): number =>
	Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt * (1 + random() * 0.3))

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(done, ms)
		signal.addEventListener("abort", done, { once: true })
		function done() {
			clearTimeout(timer)
			signal.removeEventListener("abort", done)
			resolve()
		}
	})

const whenVisible = (signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const done = () => {
			if (document.hidden && !signal.aborted) return
			document.removeEventListener("visibilitychange", done)
			signal.removeEventListener("abort", done)
			resolve()
		}
		document.addEventListener("visibilitychange", done)
		signal.addEventListener("abort", done, { once: true })
	})

const invalidate = (queryClient: QueryClient, { queryKey, idle }: LiveInvalidation) =>
	void queryClient.invalidateQueries(idle ? { queryKey, predicate: idleOnly } : { queryKey })

/** Collects shared keys and invalidates each at most once per `LIBRARY_DEBOUNCE_MS`, the first at once. */
const sharedDebouncer = (queryClient: QueryClient) => {
	const queued = new Map<string, LiveInvalidation>()
	let last = -Infinity
	let timer: ReturnType<typeof setTimeout> | null = null

	const flush = () => {
		timer = null
		last = Date.now()
		const entries = [...queued.values()]
		queued.clear()
		for (const entry of entries) invalidate(queryClient, entry)
	}

	return {
		add(entries: LiveInvalidation[]) {
			for (const entry of entries) queued.set(JSON.stringify([entry.queryKey, entry.idle ?? false]), entry)
			if (queued.size === 0 || timer !== null) return
			const wait = last + LIBRARY_DEBOUNCE_MS - Date.now()
			if (wait <= 0) flush()
			else timer = setTimeout(flush, wait)
		},
		stop() {
			if (timer !== null) clearTimeout(timer)
			timer = null
		},
	}
}

/**
 * The signed-in tab's one live feed (`GET /v1/events`). Every event is only a signal: it invalidates the
 * React Query keys the topic names (`planFor`) and the refetch goes through the usual access-checked reads,
 * so nothing arrives over the stream that the reader could not already read. Unmounted keys are not
 * refetched, so pages need no bookkeeping of their own.
 *
 * It reconnects with backoff, drops a stream that goes silent past `STALL_MS`, closes it once the tab has been
 * hidden for `HIDDEN_GRACE_MS` (reopening when it is shown again; never inside a Mac app that posts
 * Notifications, `keepOpenWhenHidden`), and the server opens every stream
 * with `resync`. The very first stream's `resync` is not invalidated when its `quietMs` shows the workspace
 * unchanged since before the page began loading (`quietSincePageLoad`) - the initial fetch already has what
 * it reports - unless a gap (a failed attempt, a hidden tab) came before it; otherwise, every later
 * reconnect's `resync`, and any `resync` after a stream's first message, invalidates as usual. A refused or missing stream (429
 * over the cap, an api without it) is silent: pages keep working as they do without it, and `useLiveStatus`
 * tells the ones that poll to keep polling.
 */
export const LiveEventsProvider = ({
	children,
	subscribe = (signal) => apiClient.events.subscribe(signal),
	random = Math.random,
	keepOpenWhenHidden = macNotifies(),
}: {
	children: ReactNode
	/** Injectable for tests. */
	subscribe?: Subscribe
	random?: () => number
	/**
	 * Inside a Mac app that posts Notifications the page lives on with its window closed, so the stream stays open
	 * while hidden. Everywhere else a hidden tab lets its stream go.
	 */
	keepOpenWhenHidden?: boolean
}) => {
	const queryClient = useQueryClient()
	const [status, setStatus] = useState<LiveStatus>("connecting")
	const [listeners] = useState(() => new Set<Listener>())
	// The loop reads these once; a re-render must not reopen the stream.
	const options = useRef({ subscribe, random, keepOpenWhenHidden })

	useEffect(() => {
		const stop = new AbortController()
		const shared = sharedDebouncer(queryClient)

		const deliver = (event: LiveEvent) => {
			const plan = planFor(event)
			for (const entry of plan.now) invalidate(queryClient, entry)
			shared.add(plan.debounced)
			for (const listener of listeners) listener(event)
		}

		// Hidden counts only where hiding lets the stream go.
		const hidden = () => !options.current.keepOpenWhenHidden && document.hidden

		const run = async () => {
			let attempt = 0
			// True until either a connect attempt fails or the tab sits hidden a while: the next successful
			// connection reached without any such gap is the provider's very first. Its first message (always
			// `resync`) is skipped when its `quietMs` shows no change since before the page began loading, so
			// the initial fetch already has what it reports. A connection reached only after a gap - a failed
			// attempt, a hidden tab - invalidates as usual, like every later reconnect and every event after
			// that stream's first.
			let pristine = true
			while (!stop.signal.aborted) {
				if (hidden()) {
					setStatus("down")
					await whenVisible(stop.signal)
					pristine = false
					continue
				}
				// One stream at a time. Unmounting, a tab hidden past the grace, or a stall closes it.
				const stream = new AbortController()
				let hiddenTimer: ReturnType<typeof setTimeout> | null = null
				let stallTimer: ReturnType<typeof setTimeout> | null = null
				const clearHidden = () => {
					if (hiddenTimer !== null) clearTimeout(hiddenTimer)
					hiddenTimer = null
				}
				const onVisibility = () => {
					if (!hidden()) clearHidden()
					else hiddenTimer ??= setTimeout(() => stream.abort(), HIDDEN_GRACE_MS)
				}
				// Any event, `ping` included, proves the stream alive; silence past `STALL_MS` is a half-open one.
				const armStall = () => {
					if (stallTimer !== null) clearTimeout(stallTimer)
					stallTimer = setTimeout(() => stream.abort(), STALL_MS)
				}
				const onStop = () => stream.abort()
				document.addEventListener("visibilitychange", onVisibility)
				stop.signal.addEventListener("abort", onStop, { once: true })
				let refused = false
				let openedAt: number | null = null
				const suppressFirstResync = pristine
				try {
					setStatus("connecting")
					armStall()
					const events = await options.current.subscribe(stream.signal)
					openedAt = Date.now()
					pristine = false
					let first = true
					for await (const event of events) {
						armStall()
						setStatus("live")
						// Only real news resets the backoff: a draining api opens with `resync` and ends at once.
						if (event.topic !== "resync" && event.topic !== "ping" && event.topic !== "webDeployed") attempt = 0
						const skip = first && suppressFirstResync && event.topic === "resync" && quietSincePageLoad(event)
						first = false
						if (skip || event.topic === "ping") continue
						deliver(event)
					}
				} catch (error) {
					// Over the cap: wait the longest before asking again. Anything else (a 503 too) is a failed attempt.
					refused = isApiError(error) && error.status === 429
					pristine = false
				} finally {
					clearHidden()
					if (stallTimer !== null) clearTimeout(stallTimer)
					document.removeEventListener("visibilitychange", onVisibility)
					stop.signal.removeEventListener("abort", onStop)
				}
				if (stop.signal.aborted) return
				if (openedAt !== null && Date.now() - openedAt >= STABLE_MS) attempt = 0
				setStatus("down")
				// Hidden: wait for the tab to come back, then reconnect at once (the server resyncs).
				if (hidden()) continue
				await sleep(refused ? RETRY_MAX_MS : retryDelay(attempt, options.current.random), stop.signal)
				attempt += 1
			}
		}

		void run()
		return () => {
			stop.abort()
			shared.stop()
		}
	}, [queryClient, listeners])

	return <LiveContext.Provider value={{ status, listeners }}>{children}</LiveContext.Provider>
}

/** Whether the live feed is up. Outside the provider (signed out, tests) it is `down`. */
export const useLiveStatus = (): LiveStatus => useContext(LiveContext).status

/** Runs `listener` for every live event, after its keys are invalidated; no connection of its own. */
export const useLiveEvent = (listener: Listener) => {
	const { listeners } = useContext(LiveContext)
	const latest = useRef(listener)
	useEffect(() => {
		latest.current = listener
	})
	useEffect(() => {
		const call: Listener = (event) => latest.current(event)
		listeners.add(call)
		return () => {
			listeners.delete(call)
		}
	}, [listeners])
}
