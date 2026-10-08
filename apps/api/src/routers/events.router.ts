import { eventsContract } from "@exagram/core/contract/events/contract"
import { RateLimitedError } from "@exagram/core/utils/errors"
import { implement, ORPCError } from "@orpc/server"

import type { LiveEvent } from "@exagram/core/contract/events/type"
import type { ChangeFeed } from "@exagram/core/services/change-feed.port"

import { requireUser } from "../plugins/require-user.middleware"

import type { AuthContext, BaseContext, SessionUser } from "../plugins/context"

export const EVENT_STREAMS_PER_USER = 20
export const EVENT_STREAMS_PER_PROCESS = 2000

/** A client that stops reading gets one `resync` in place of an unbounded backlog. */
const MAX_QUEUED_EVENTS = 100

/** A data-level heartbeat: well inside every idle timeout on the way, and it lets a client spot a half-open stream. */
export const EVENT_PING_MS = 25_000
/**
 * A stream outlives no session check by more than this: a cloud load balancer already cuts at 300 s, and this makes a
 * self-hosted stream end the same way, so a revoked session stops hearing within five minutes.
 */
export const EVENT_STREAM_MAX_MS = 300_000

const RESYNC: LiveEvent = { topic: "resync", artifactId: null }
const PING: LiveEvent = { topic: "ping", artifactId: null }

interface EventsRouterParams {
	changeFeed: ChangeFeed
	/** Aborts when the api starts draining, so every open stream ends before `SHUTDOWN_TIMEOUT_SEC`. */
	shutdown: AbortSignal
	limits?: { perUser: number; perProcess: number }
	pingMs?: number
	maxStreamMs?: number
}

export const createEventsRouter = ({ changeFeed, shutdown, limits, pingMs, maxStreamMs }: EventsRouterParams) => {
	const perUserLimit = limits?.perUser ?? EVENT_STREAMS_PER_USER
	const perProcessLimit = limits?.perProcess ?? EVENT_STREAMS_PER_PROCESS
	const openByUser = new Map<string, number>()
	let openTotal = 0

	// Taken before the response starts, so an over-cap caller gets a plain 429 instead of a stream that errors.
	const take = (userId: string): (() => void) => {
		const open = openByUser.get(userId) ?? 0
		if (open >= perUserLimit)
			throw new RateLimitedError(`Live updates are limited to ${perUserLimit} open streams per user.`)
		if (openTotal >= perProcessLimit) throw new RateLimitedError("Live updates are at capacity. Try again shortly.")
		openByUser.set(userId, open + 1)
		openTotal += 1
		let released = false
		return () => {
			if (released) return
			released = true
			openTotal -= 1
			const left = (openByUser.get(userId) ?? 1) - 1
			if (left === 0) openByUser.delete(userId)
			else openByUser.set(userId, left)
		}
	}

	async function* stream(user: SessionUser, signal: AbortSignal, release: () => void): AsyncGenerator<LiveEvent> {
		const queue: LiveEvent[] = []
		let wake: (() => void) | null = null
		const notify = () => {
			wake?.()
			wake = null
		}
		const unsubscribe = changeFeed.subscribeUser(
			{ userId: user.id, sessionId: user.sessionId, workspaceId: user.workspaceId },
			(event) => {
				if (queue.length >= MAX_QUEUED_EVENTS) queue.splice(0, queue.length, RESYNC)
				else queue.push(event)
				notify()
			},
		)
		signal.addEventListener("abort", notify)
		const ping = setInterval(() => {
			if (queue.length === 0) queue.push(PING)
			notify()
		}, pingMs ?? EVENT_PING_MS)
		try {
			// Subscribed before this goes out, so nothing that changes after the client's refetch is missed. The quiet
			// is read after subscribing too: any notice later than it reaches this stream as its own event.
			yield {
				topic: "resync",
				artifactId: null,
				quietMs: changeFeed.quietMs({ userId: user.id, workspaceId: user.workspaceId }),
			}
			while (!signal.aborted) {
				const next = queue.shift()
				if (next) {
					yield next
					continue
				}
				await new Promise<void>((resolve) => {
					wake = resolve
				})
			}
		} finally {
			clearInterval(ping)
			signal.removeEventListener("abort", notify)
			unsubscribe()
			release()
		}
	}

	const os = implement(eventsContract).$context<BaseContext>()
	const authed = os.$context<AuthContext>()

	return os.use(requireUser).router({
		subscribe: authed.subscribe.handler(({ context, signal }) => {
			// A draining pod sends no resync the client would act on; it reconnects to one that is not.
			if (shutdown.aborted) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Live updates are restarting." })
			const release = take(context.user.id)
			const lifetime = AbortSignal.timeout(maxStreamMs ?? EVENT_STREAM_MAX_MS)
			const ended = AbortSignal.any(signal ? [signal, shutdown, lifetime] : [shutdown, lifetime])
			// A stream the client drops before its first read never runs the generator's `finally`.
			ended.addEventListener("abort", release, { once: true })
			// For an nginx a self-hoster puts in front; Caddy and a cloud load balancer pass SSE through unbuffered.
			context.resHeaders?.set("X-Accel-Buffering", "no")
			return stream(context.user, ended, release)
		}),
	})
}
