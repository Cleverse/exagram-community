import { createRouterClient } from "@orpc/server"
import { describe, expect, it } from "vitest"

import type { LiveEvent } from "@exagram/core/contract/events/type"
import type { ChangeFeed } from "@exagram/core/services/change-feed.port"

import { createEventsRouter } from "./events.router"

import type { BaseContext } from "../plugins/context"

const user = {
	id: "11111111-1111-4111-8111-111111111111",
	sessionId: "44444444-4444-4444-8444-444444444444",
	workspaceId: "22222222-2222-4222-8222-222222222222",
	email: "owner@example.com",
	name: "Owner",
	isAdmin: false,
	googleLinked: false,
	createdAt: new Date(),
}
const artifactId = "33333333-3333-4333-8333-333333333333"
const RESYNC = { topic: "resync", artifactId: null }

interface Quiet {
	ms: number
	asked: { userId: string; workspaceId: string }[]
}

const fakeFeed = (quiet: Quiet = { ms: 0, asked: [] }) => {
	const subscribers = new Set<{
		input: { userId: string; sessionId: string; workspaceId: string }
		onEvent: (e: LiveEvent) => void
	}>()
	const feed: ChangeFeed = {
		subscribeUser(input, onEvent) {
			const entry = { input, onEvent }
			subscribers.add(entry)
			return () => subscribers.delete(entry)
		},
		subscribeLink: () => () => {},
		isListening: () => true,
		quietMs(input) {
			quiet.asked.push(input)
			// Read only once the stream is subscribed, so a change after it is delivered.
			expect(subscribers.size).toBeGreaterThan(0)
			return quiet.ms
		},
		close: async () => {},
	}
	const emit = (event: LiveEvent) => {
		for (const s of subscribers) s.onEvent(event)
	}
	return { feed, subscribers, emit }
}

const build = (
	limits?: { perUser: number; perProcess: number },
	signedIn: typeof user | null = user,
	timing: { pingMs?: number; maxStreamMs?: number } = {},
	quiet?: Quiet,
) => {
	const { feed, subscribers, emit } = fakeFeed(quiet)
	const shutdown = new AbortController()
	const router = createEventsRouter({ changeFeed: feed, shutdown: shutdown.signal, limits, ...timing })
	const headers = new Headers()
	const client = createRouterClient(router, {
		context: { headers: {}, requestId: "r1", user: signedIn, resHeaders: headers } as unknown as BaseContext,
	})
	return { client, subscribers, emit, shutdown, headers }
}

describe("events router", () => {
	it("sends resync first, then forwards the caller's feed events", async () => {
		const { client, subscribers, emit, headers } = build()
		const stream = await client.subscribe({})

		expect(await stream.next()).toEqual({ done: false, value: { ...RESYNC, quietMs: 0 } })
		expect([...subscribers].map((s) => s.input)).toEqual([
			{ userId: user.id, sessionId: user.sessionId, workspaceId: user.workspaceId },
		])
		expect(headers.get("x-accel-buffering")).toBe("no")

		const event: LiveEvent = { topic: "current", artifactId }
		const next = stream.next()
		emit(event)
		expect(await next).toEqual({ done: false, value: event })
		await stream.return?.(undefined)
	})

	it("opens with the caller's quiet in their session's workspace, read once subscribed; later resyncs carry none", async () => {
		const quiet: Quiet = { ms: 42_000, asked: [] }
		const { client, emit } = build(undefined, user, {}, quiet)
		const stream = await client.subscribe({})

		expect(await stream.next()).toEqual({ done: false, value: { ...RESYNC, quietMs: 42_000 } })
		expect(quiet.asked).toEqual([{ userId: user.id, workspaceId: user.workspaceId }])

		const next = stream.next()
		emit(RESYNC as LiveEvent)
		expect(await next).toEqual({ done: false, value: RESYNC })
		expect(quiet.asked).toHaveLength(1)
		await stream.return?.(undefined)
	})

	it("refuses a caller with no session", async () => {
		const { client } = build(undefined, null)
		await expect(client.subscribe({})).rejects.toMatchObject({ code: "UNAUTHORIZED" })
	})

	it("refuses the stream past the per-user cap with a 429, and frees the slot when one closes", async () => {
		const { client } = build({ perUser: 2, perProcess: 10 })
		const first = await client.subscribe({})
		await first.next()
		await client.subscribe({})

		await expect(client.subscribe({})).rejects.toMatchObject({ statusCode: 429 })

		await first.return?.(undefined)
		await expect(client.subscribe({})).resolves.toBeDefined()
	})

	it("refuses past the per-process cap across users", async () => {
		const { client } = build({ perUser: 5, perProcess: 1 })
		await client.subscribe({})
		await expect(client.subscribe({})).rejects.toMatchObject({ statusCode: 429 })
	})

	it("unsubscribes and ends the stream when the request aborts", async () => {
		const { client, subscribers } = build()
		const abort = new AbortController()
		const stream = await client.subscribe({}, { signal: abort.signal })
		await stream.next()
		const pending = stream.next()

		abort.abort()

		await expect(pending).resolves.toMatchObject({ done: true })
		expect(subscribers.size).toBe(0)
	})

	it("ends every open stream when the api drains", async () => {
		const { client, subscribers, shutdown } = build()
		const stream = await client.subscribe({})
		await stream.next()
		const pending = stream.next()

		shutdown.abort()

		await expect(pending).resolves.toMatchObject({ done: true })
		expect(subscribers.size).toBe(0)
	})

	it("collapses a backlog a slow reader never drained into one resync", async () => {
		const { client, emit } = build()
		const stream = await client.subscribe({})
		await stream.next()
		for (let i = 0; i < 150; i++) emit({ topic: "current", artifactId })

		const seen: LiveEvent[] = []
		for (let i = 0; i < 50; i++) seen.push((await stream.next()).value as LiveEvent)
		expect(seen[0]).toEqual(RESYNC)
		expect(seen.slice(1).every((e) => e.topic === "current")).toBe(true)
		await stream.return?.(undefined)
	})

	it("sends a ping event while nothing changes", async () => {
		const { client } = build(undefined, user, { pingMs: 20 })
		const stream = await client.subscribe({})
		await stream.next()

		expect(await stream.next()).toEqual({ done: false, value: { topic: "ping", artifactId: null } })
		await stream.return?.(undefined)
	})

	it("refuses with a 503 and sends no resync once the api is draining", async () => {
		const { client, subscribers, shutdown } = build()
		shutdown.abort()

		await expect(client.subscribe({})).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 })
		expect(subscribers.size).toBe(0)
	})

	it("ends a stream at its lifetime cap, so a revoked session stops hearing", async () => {
		const { client, subscribers } = build({ perUser: 1, perProcess: 10 }, user, { maxStreamMs: 50 })
		const stream = await client.subscribe({})
		await stream.next()

		await expect(stream.next()).resolves.toMatchObject({ done: true })
		expect(subscribers.size).toBe(0)
		// The slot is back, so the reconnect (which re-runs the session check) is let in.
		await expect(client.subscribe({})).resolves.toBeDefined()
	})
})
