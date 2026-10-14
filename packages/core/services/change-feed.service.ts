import { type LiveEvent, type LiveTopic } from "../contract/events/type"

import {
	CHANGE_CHANNEL,
	type ChangeFeed,
	type ChangeFeedDeps,
	type ChangeNotice,
	ChangeNoticeSchema,
	SessionSwitchedNoticeSchema,
	WebDeployedNoticeSchema,
} from "./change-feed.port"

export interface ChangeFeedLogger {
	warn(message: string, detail?: unknown): void
	error(message: string, detail?: unknown): void
}

export interface ChangeFeedOptions {
	/**
	 * The window in which repeat notices for one (workspace, Artifact, topic) collapse into one reach query, and
	 * repeat events for one (subscriber, Artifact, topic) into one trailing delivery.
	 */
	coalesceMs?: number
	/** Reach queries running at once; the rest wait in a FIFO queue. */
	maxReachQueries?: number
	/** Queued reach queries one workspace may pile up before they are dropped for a single workspace `resync`. */
	maxQueuedPerWorkspace?: number
	logger?: ChangeFeedLogger
}

interface Window {
	timer: ReturnType<typeof setTimeout>
	pending: LiveEvent | null
}

interface Subscriber {
	userId: string
	sessionId: string
	workspaceId: string
	onEvent: (event: LiveEvent) => void
	windows: Map<string, Window>
}

interface LinkHandlers {
	onGone: () => void
	onReset: () => void
}

interface ReachJob {
	key: string
	w: string
	a: string
	t: LiveTopic
}

const RESYNC: LiveEvent = { topic: "resync", artifactId: null }
const WEB_DEPLOYED: LiveEvent = { topic: "webDeployed", artifactId: null }

/**
 * Starts the one LISTEN this process holds and routes each change notice to the connected users who should hear it.
 * Events carry ids only, so a wide delivery leaks nothing: the refetch they trigger re-checks access.
 */
export async function createChangeFeed(deps: ChangeFeedDeps, options: ChangeFeedOptions = {}): Promise<ChangeFeed> {
	const coalesceMs = options.coalesceMs ?? 250
	const maxReachQueries = options.maxReachQueries ?? 3
	const maxQueuedPerWorkspace = options.maxQueuedPerWorkspace ?? 200
	const logger = options.logger ?? console
	const byUser = new Map<string, Set<Subscriber>>()
	const bySession = new Map<string, Set<Subscriber>>()
	const links = new Map<string, Set<LinkHandlers>>()
	// Notices waiting out their window before a reach query, keyed by (workspace, Artifact, topic).
	const buffered = new Map<string, { w: string; timer: ReturnType<typeof setTimeout> }>()
	const queue: ReachJob[] = []
	const running = new Set<ReachJob>()
	let listening = false
	let closed = false
	// When the last notice for each workspace arrived; a workspace with none counts from `listeningSince`.
	const lastNotice = new Map<string, number>()
	const lastReached = new Map<string, number>()
	let listeningSince = 0

	function send(subscriber: Subscriber, event: LiveEvent): void {
		try {
			subscriber.onEvent(event)
		} catch (error) {
			logger.error("change feed subscriber threw", error)
		}
	}

	// Leading delivery, then at most one trailing delivery per window, so the last change in a burst is never lost.
	function deliver(subscriber: Subscriber, event: LiveEvent): void {
		const key = `${event.artifactId ?? ""}:${event.topic}`
		const open = subscriber.windows.get(key)
		if (open) {
			open.pending = event
			return
		}
		send(subscriber, event)
		const window: Window = { timer: setTimeout(flush, coalesceMs), pending: null }
		subscriber.windows.set(key, window)
		function flush(): void {
			if (!window.pending) {
				subscriber.windows.delete(key)
				return
			}
			send(subscriber, window.pending)
			window.pending = null
			window.timer = setTimeout(flush, coalesceMs)
		}
	}

	function deliverToUsers(userIds: Iterable<string>, event: LiveEvent): void {
		for (const userId of userIds) {
			const subscribers = byUser.get(userId)
			if (!subscribers) continue
			lastReached.set(userId, Date.now())
			for (const subscriber of subscribers) deliver(subscriber, event)
		}
	}

	function deliverToWorkspace(workspaceId: string, event: LiveEvent): void {
		for (const subscribers of byUser.values()) {
			for (const subscriber of subscribers) if (subscriber.workspaceId === workspaceId) deliver(subscriber, event)
		}
	}

	function deliverToAll(event: LiveEvent): void {
		for (const subscribers of byUser.values()) for (const subscriber of subscribers) deliver(subscriber, event)
	}

	function callLink(fn: () => void): void {
		try {
			fn()
		} catch (error) {
			logger.error("change feed Link subscriber threw", error)
		}
	}

	function fireLinks(linkIds: readonly string[]): void {
		for (const linkId of linkIds) {
			const handlers = links.get(linkId)
			if (!handlers) continue
			links.delete(linkId)
			for (const handler of handlers) callLink(handler.onGone)
		}
	}

	// Runs queued reach queries, at most `maxReachQueries` at a time, oldest first.
	function pump(): void {
		while (!closed && running.size < maxReachQueries && queue.length > 0) {
			const job = queue.shift()!
			running.add(job)
			void runReach(job).finally(() => {
				running.delete(job)
				pump()
			})
		}
	}

	async function runReach(job: ReachJob): Promise<void> {
		// Checked again at run time: whoever was connected when the notice came may have left.
		if (byUser.size === 0) return
		let audience: { userId: string; member: boolean }[]
		try {
			audience = await deps.audience(job.a, job.w)
		} catch (error) {
			logger.error("change feed reach query failed; dropping notice", error)
			return
		}
		if (closed) return
		const event: LiveEvent = { topic: job.t, artifactId: job.a }
		for (const { userId, member } of audience) {
			const subscribers = byUser.get(userId)
			if (!subscribers) continue
			for (const subscriber of subscribers) {
				if (member && subscriber.workspaceId !== job.w) continue
				lastReached.set(userId, Date.now())
				deliver(subscriber, event)
			}
		}
	}

	function enqueue(job: ReachJob): void {
		if (queue.some((queued) => queued.key === job.key)) return
		queue.push(job)
		// A burst this large (a bulk upload, an approve-all) is cheaper as one refetch of everything than as
		// hundreds of reach queries, so the workspace's backlog is dropped for a single resync.
		if (queue.filter((queued) => queued.w === job.w).length > maxQueuedPerWorkspace) {
			for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.w === job.w) queue.splice(i, 1)
			logger.warn("change feed reach backlog overflowed; resyncing the workspace", job.w)
			deliverToWorkspace(job.w, RESYNC)
			return
		}
		pump()
	}

	function route(notice: ChangeNotice): void {
		if (notice.l) fireLinks(notice.l)
		// `link` only ends Links; it never reaches a user feed.
		if (notice.t === "link") return

		if (byUser.size === 0) return
		const event: LiveEvent = { topic: notice.t, artifactId: notice.a }

		// A named audience (delete, lost Grant) is used as-is and at once: after commit `reaches_artifact` is
		// already false for them, so there is nothing to query.
		if (notice.u) {
			deliverToUsers(notice.u, event)
			return
		}
		// No Artifact to check reach against (a workspace resync, a Project change): every connected user in the
		// workspace hears it. The event names no Project and the refetch goes through the access-checked endpoints.
		if (!notice.a) {
			deliverToWorkspace(notice.w, event)
			return
		}
		// Everything else waits out one window, so a burst on one Artifact costs one reach query.
		const job: ReachJob = { key: `${notice.w}:${notice.a}:${notice.t}`, w: notice.w, a: notice.a, t: notice.t }
		if (buffered.has(job.key)) return
		buffered.set(job.key, {
			w: job.w,
			timer: setTimeout(() => {
				buffered.delete(job.key)
				enqueue(job)
			}, coalesceMs),
		})
	}

	function moveSession(sessionId: string, workspaceId: string): void {
		for (const subscriber of bySession.get(sessionId) ?? []) {
			subscriber.workspaceId = workspaceId
			deliver(subscriber, RESYNC)
		}
	}

	function onNotify(payload: string): void {
		if (closed) return
		let parsed: unknown
		try {
			parsed = JSON.parse(payload)
		} catch {
			logger.warn("change feed dropped a payload that is not JSON", payload)
			return
		}
		// Not a workspace change, so it leaves every `quietMs` alone.
		if (WebDeployedNoticeSchema.safeParse(parsed).success) {
			deliverToAll(WEB_DEPLOYED)
			return
		}
		const switched = SessionSwitchedNoticeSchema.safeParse(parsed)
		if (switched.success) {
			moveSession(switched.data.s, switched.data.w)
			return
		}
		const notice = ChangeNoticeSchema.safeParse(parsed)
		if (!notice.success) {
			logger.warn("change feed dropped a malformed notice", payload)
			return
		}
		// On receipt, before any coalescing: `quietMs` must never vouch past a change that is still in a window.
		lastNotice.set(notice.data.w, Date.now())
		route(notice.data)
	}

	// postgres.js calls this on the first connect and again after every reconnect. Notices sent while the
	// connection was down are lost, so a reconnect tells every open stream to refetch, and ends every Link
	// stream so the route checks each Link again.
	function onListen(): void {
		if (closed) return
		if (listening) {
			deliverToAll(RESYNC)
			const reset = [...links.values()]
			links.clear()
			for (const handlers of reset) for (const handler of handlers) callLink(handler.onReset)
		}
		// The gap before a reconnect may have lost notices for any workspace, so every quiet restarts now.
		lastNotice.clear()
		lastReached.clear()
		listeningSince = Date.now()
		listening = true
	}

	const { unlisten } = await deps.listen(CHANGE_CHANNEL, onNotify, onListen)

	function clearSubscriber(subscriber: Subscriber): void {
		for (const window of subscriber.windows.values()) clearTimeout(window.timer)
		subscriber.windows.clear()
	}

	function add<K>(index: Map<K, Set<Subscriber>>, key: K, subscriber: Subscriber): void {
		let set = index.get(key)
		if (!set) {
			set = new Set()
			index.set(key, set)
		}
		set.add(subscriber)
	}

	function remove<K>(index: Map<K, Set<Subscriber>>, key: K, subscriber: Subscriber): boolean {
		const set = index.get(key)
		if (!set) return false
		set.delete(subscriber)
		if (set.size > 0) return false
		index.delete(key)
		return true
	}

	function reachPendingOutside(workspaceId: string): boolean {
		for (const { w } of buffered.values()) if (w !== workspaceId) return true
		for (const job of queue) if (job.w !== workspaceId) return true
		for (const job of running) if (job.w !== workspaceId) return true
		return false
	}

	return {
		// Does not emit the opening `resync` itself: the api router yields that first on every stream.
		subscribeUser({ userId, sessionId, workspaceId }, onEvent) {
			if (closed) return () => {}
			const subscriber: Subscriber = { userId, sessionId, workspaceId, onEvent, windows: new Map() }
			add(byUser, userId, subscriber)
			add(bySession, sessionId, subscriber)
			return () => {
				clearSubscriber(subscriber)
				remove(bySession, sessionId, subscriber)
				if (remove(byUser, userId, subscriber)) lastReached.delete(userId)
			}
		},
		subscribeLink(linkId, { onGone, onReset }) {
			if (closed) return () => {}
			// A fresh object per call, so the same handlers subscribed twice unsubscribe independently.
			const handler: LinkHandlers = { onGone, onReset }
			let set = links.get(linkId)
			if (!set) {
				set = new Set()
				links.set(linkId, set)
			}
			set.add(handler)
			return () => {
				const current = links.get(linkId)
				if (!current) return
				current.delete(handler)
				if (current.size === 0) links.delete(linkId)
			}
		},
		isListening() {
			// Stays true through a dropped connection: postgres.js exposes no disconnect hook, only `onlisten`.
			return listening && !closed
		},
		quietMs({ userId, workspaceId }) {
			if (!listening || closed || reachPendingOutside(workspaceId)) return 0
			const now = Date.now()
			const workspaceQuiet = now - (lastNotice.get(workspaceId) ?? listeningSince)
			const reachedQuiet = now - (lastReached.get(userId) ?? listeningSince)
			return Math.max(0, Math.min(workspaceQuiet, reachedQuiet))
		},
		async close() {
			if (closed) return
			closed = true
			listening = false
			for (const subscribers of byUser.values()) for (const subscriber of subscribers) clearSubscriber(subscriber)
			for (const { timer } of buffered.values()) clearTimeout(timer)
			buffered.clear()
			queue.length = 0
			lastNotice.clear()
			lastReached.clear()
			byUser.clear()
			bySession.clear()
			links.clear()
			await unlisten()
		},
	}
}
