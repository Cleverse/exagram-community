import { hashLinkToken } from "@exagram/core/services/link-token.service"

import type { LinksDatagateway } from "@exagram/core/datagateway/links.datagateway"
import type { ChangeFeed } from "@exagram/core/services/change-feed.port"

import { clientIp } from "./client-ip"
import { refuseLink } from "./link-page.route"

import type { FastifyInstance } from "fastify"

export const LINK_STREAMS_PER_IP = 5
export const LINK_STREAMS_PER_PROCESS = 500
export const LINK_HEARTBEAT_MS = 25_000

// setTimeout fires at once past 2^31-1 ms, so a far expiry is reached in steps.
const MAX_TIMER_MS = 2_147_483_647

const GONE_EVENT = `event: state\ndata: {"state":"gone"}\n\n`

export interface LinkEventsParams {
	links: LinksDatagateway
	changeFeed: ChangeFeed
	/** Aborts when the api starts draining, so every open stream ends before `SHUTDOWN_TIMEOUT_SEC`. */
	shutdown: AbortSignal
	/** `ENV.CLIENT_IP_HEADER`: the header that carries the client address, or null for the TCP peer. */
	clientIpHeader: string | null
	limits?: { perIp: number; perProcess: number }
	heartbeatMs?: number
}

/**
 * `GET /l/:token/events`: tells an open Link page when to hide its content. It carries one event, never
 * content, and opening it writes no Ledger row and claims no view.
 */
export const registerLinkEventsRoute = (app: FastifyInstance, params: LinkEventsParams): void => {
	const perIpLimit = params.limits?.perIp ?? LINK_STREAMS_PER_IP
	const perProcessLimit = params.limits?.perProcess ?? LINK_STREAMS_PER_PROCESS
	const heartbeatMs = params.heartbeatMs ?? LINK_HEARTBEAT_MS
	const openByIp = new Map<string, number>()
	let openTotal = 0

	app.get<{ Params: { token: string } }>("/l/:token/events", async (request, reply) => {
		const notReady = () => reply.code(503).header("Cache-Control", "no-store").type("text/plain").send("NOT READY")
		if (params.shutdown.aborted) return notReady()
		// The slot is taken before any lookup, so a flood of streams never reaches the database.
		const ip = clientIp(request, params.clientIpHeader)
		const open = openByIp.get(ip) ?? 0
		if (open >= perIpLimit || openTotal >= perProcessLimit) {
			return reply.code(429).header("Cache-Control", "no-store").type("text/plain").send("Too many open Link streams.")
		}
		openByIp.set(ip, open + 1)
		openTotal += 1

		const res = reply.raw
		let ended = false
		let streaming = false
		let early: "gone" | "reset" | null = null
		const timers: { heartbeat?: ReturnType<typeof setInterval>; expiry?: ReturnType<typeof setTimeout> } = {}
		let unsubscribe = () => {}

		// Every exit runs this once: a refusal, a client that leaves mid-lookup, gone, a reset or a drain.
		const end = (gone: boolean) => {
			if (ended) return
			ended = true
			clearInterval(timers.heartbeat)
			clearTimeout(timers.expiry)
			unsubscribe()
			params.shutdown.removeEventListener("abort", onShutdown)
			res.off("close", onClose)
			openTotal -= 1
			const left = (openByIp.get(ip) ?? 1) - 1
			if (left === 0) openByIp.delete(ip)
			else openByIp.set(ip, left)
			if (streaming && !res.writableEnded) res.end(gone ? GONE_EVENT : undefined)
		}
		const onClose = () => end(false)
		const onShutdown = () => end(false)
		// Registered before the lookups, so a client that leaves while they run frees its slot at once.
		res.on("close", onClose)
		params.shutdown.addEventListener("abort", onShutdown, { once: true })

		// Ended while a lookup ran: the client left (nothing to answer) or the api began draining.
		const answerEnded = () => (res.destroyed ? reply.hijack() : notReady())
		const refuse = () => {
			end(false)
			return refuseLink(reply)
		}

		// An unknown token and a Link that is revoked, expired or whose Artifact is gone look the same as on the page.
		const linkId = await params.links.findIdByTokenHash(hashLinkToken(request.params.token))
		if (ended) return answerEnded()
		if (linkId === null) return refuse()

		// Subscribed before the check, so a revoke that commits between the two is never missed.
		unsubscribe = params.changeFeed.subscribeLink(linkId, {
			onGone: () => (streaming ? end(true) : (early = "gone")),
			// A LISTEN reconnect may have missed a revoke: end plainly, and the page reconnects into a fresh check.
			onReset: () => (streaming ? end(false) : (early ??= "reset")),
		})
		const expiresAt = await params.links.findWatchableExpiry(linkId)
		if (ended) return answerEnded()
		if (expiresAt === null || early === "gone") return refuse()

		reply.hijack()
		if (res.destroyed) return end(false)
		streaming = true
		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
			// For an nginx a self-hoster puts in front; Caddy and a cloud load balancer pass SSE through unbuffered.
			"X-Accel-Buffering": "no",
		})
		res.write(": \n\n")
		if (early === "reset") return end(false)

		timers.heartbeat = setInterval(() => res.write(": \n\n"), heartbeatMs)
		const waitForExpiry = () => {
			const left = expiresAt.getTime() - Date.now()
			if (left <= 0) return end(true)
			timers.expiry = setTimeout(waitForExpiry, Math.min(left, MAX_TIMER_MS))
		}
		waitForExpiry()
	})
}
