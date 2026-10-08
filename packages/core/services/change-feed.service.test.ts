import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { type LiveEvent } from "../contract/events/type"

import {
	CHANGE_CHANNEL,
	type ChangeFeed,
	type ChangeFeedDeps,
	type ChangeNotice,
	WEB_DEPLOYED_NOTICE,
} from "./change-feed.port"
import { createChangeFeed } from "./change-feed.service"

const W = "00000000-0000-4000-8000-000000000001"
const W2 = "00000000-0000-4000-8000-000000000002"
const W3 = "00000000-0000-4000-8000-000000000003"
const ALICE = "00000000-0000-4000-8000-0000000000a1"
const BOB = "00000000-0000-4000-8000-0000000000b1"
const CAROL = "00000000-0000-4000-8000-0000000000ca"
const GHOST = "00000000-0000-4000-8000-0000000000e9"
const ARTIFACT = "00000000-0000-4000-8000-0000000000f1"
const ARTIFACT_2 = "00000000-0000-4000-8000-0000000000f2"
const PROJECT = "00000000-0000-4000-8000-0000000000c1"
const LINK = "00000000-0000-4000-8000-0000000000d1"
const SESSION_1 = "00000000-0000-4000-9000-000000000001"
const SESSION_2 = "00000000-0000-4000-9000-000000000002"
const SESSION_UNKNOWN = "00000000-0000-4000-9000-0000000000ff"

const CURRENT: LiveEvent = { topic: "current", artifactId: ARTIFACT }
const RESYNC: LiveEvent = { topic: "resync", artifactId: null }

type Audience = Awaited<ReturnType<ChangeFeedDeps["audience"]>>

const member = (userId: string) => ({ userId, member: true })
const guest = (userId: string) => ({ userId, member: false })
const answer =
	(...people: Audience) =>
	() =>
		Promise.resolve(people)

function artifactId(i: number): string {
	return `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`
}

function notice(partial: Partial<ChangeNotice>): string {
	return JSON.stringify({ w: W, a: ARTIFACT, p: PROJECT, t: "current", u: null, l: null, ...partial })
}

function switched(sessionId: string, workspaceId: string): string {
	return JSON.stringify({ t: "sessionSwitched", s: sessionId, w: workspaceId })
}

function fakeDeps(
	reaching: (artifactId: string, workspaceId: string) => Promise<Audience> = answer(),
	{ listening = true }: { listening?: boolean } = {},
) {
	const state: { onNotify?: (payload: string) => void; onListen?: () => void; channel?: string } = {}
	const unlisten = vi.fn(async () => {})
	const audience = vi.fn(reaching)
	const deps: ChangeFeedDeps = {
		listen(channel, onNotify, onListen) {
			state.channel = channel
			state.onNotify = onNotify
			state.onListen = onListen
			if (listening) onListen()
			return Promise.resolve({ unlisten })
		},
		audience,
	}
	return { deps, state, unlisten, audience }
}

function heldAudiences() {
	const held: { artifactId: string; workspaceId: string; resolve: (people: Audience) => void }[] = []
	const reaching = (artifactId: string, workspaceId: string) =>
		new Promise<Audience>((resolve) => held.push({ artifactId, workspaceId, resolve }))
	return { held, reaching }
}

let opened = 0
function connect(feed: ChangeFeed, userId: string, workspaceId: string, sessionId?: string) {
	opened += 1
	const session = sessionId ?? `00000000-0000-4000-9000-${(0x1000 + opened).toString(16).padStart(12, "0")}`
	const events: LiveEvent[] = []
	const close = feed.subscribeUser({ userId, sessionId: session, workspaceId }, (event) => events.push(event))
	return { events, close }
}

function linkHandlers() {
	return { onGone: vi.fn(), onReset: vi.fn() }
}

const logger = { warn: vi.fn(), error: vi.fn() }

// Waits out the pre-query window and lets the reach query settle.
const tick = (ms = 250) => vi.advanceTimersByTimeAsync(ms)

describe("change feed", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		logger.warn.mockClear()
		logger.error.mockClear()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("listens on the change channel and reports listening", async () => {
		const { deps, state } = fakeDeps()
		const feed = await createChangeFeed(deps, { logger })
		expect(state.channel).toBe(CHANGE_CHANNEL)
		expect(feed.isListening()).toBe(true)
	})

	describe("an Artifact notice", () => {
		it("asks for the audience once, after the window, and sends { topic, artifactId } to the people it lists only", async () => {
			const { deps, state, audience } = fakeDeps(answer(member(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W)
			const bob = connect(feed, BOB, W)

			state.onNotify!(notice({}))
			expect(audience).not.toHaveBeenCalled()
			await tick()

			expect(audience).toHaveBeenCalledTimes(1)
			expect(audience).toHaveBeenCalledWith(ARTIFACT, W)
			expect(alice.events).toEqual([CURRENT])
			expect(bob.events).toEqual([])
		})

		it("reaches a member only while their session acts in the Artifact's workspace", async () => {
			const { deps, state, audience } = fakeDeps(answer(member(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const inWorkspace = connect(feed, ALICE, W)
			const elsewhere = connect(feed, ALICE, W2)

			state.onNotify!(notice({}))
			await tick()

			expect(audience).toHaveBeenCalledTimes(1)
			expect(inWorkspace.events).toEqual([CURRENT])
			expect(elsewhere.events).toEqual([])
		})

		it("reaches a Guest wherever their session acts, and a member acting elsewhere in the same answer not at all", async () => {
			const { deps, state } = fakeDeps(answer(guest(ALICE), member(BOB)))
			const feed = await createChangeFeed(deps, { logger })
			const guestInTeam = connect(feed, ALICE, W2)
			const guestInPersonal = connect(feed, ALICE, W3)
			const memberElsewhere = connect(feed, BOB, W2)

			state.onNotify!(notice({}))
			await tick()

			expect(guestInTeam.events).toEqual([CURRENT])
			expect(guestInPersonal.events).toEqual([CURRENT])
			expect(memberElsewhere.events).toEqual([])
		})

		it("runs one audience query for a workspace nobody acts in, so a Guest can hear it", async () => {
			const { deps, state, audience } = fakeDeps(answer(guest(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W2)
			const bob = connect(feed, BOB, W2)

			state.onNotify!(notice({ w: W3 }))
			await tick()

			expect(audience).toHaveBeenCalledTimes(1)
			expect(audience).toHaveBeenCalledWith(ARTIFACT, W3)
			expect(alice.events).toEqual([CURRENT])
			expect(bob.events).toEqual([])
		})

		it("runs no audience query when nobody is connected", async () => {
			const { deps, state, audience } = fakeDeps(answer(guest(ALICE)))
			await createChangeFeed(deps, { logger })

			state.onNotify!(notice({}))
			await tick()

			expect(audience).not.toHaveBeenCalled()
		})

		it("runs no audience query when everyone left during the window", async () => {
			const { deps, state, audience } = fakeDeps(answer(member(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W)

			state.onNotify!(notice({}))
			alice.close()
			await tick()

			expect(audience).not.toHaveBeenCalled()
		})

		it("coalesces a burst on one Artifact and topic into one audience query per window", async () => {
			const { deps, state, audience } = fakeDeps(answer(member(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W)

			for (let i = 0; i < 10; i++) state.onNotify!(notice({}))
			state.onNotify!(notice({ t: "revisions" }))
			state.onNotify!(notice({ a: ARTIFACT_2 }))
			await tick()

			expect(audience).toHaveBeenCalledTimes(3)
			expect(alice.events).toEqual([
				{ topic: "current", artifactId: ARTIFACT },
				{ topic: "revisions", artifactId: ARTIFACT },
				{ topic: "current", artifactId: ARTIFACT_2 },
			])

			// A later window runs its own query.
			state.onNotify!(notice({}))
			await tick()
			expect(audience).toHaveBeenCalledTimes(4)
		})

		it("runs at most three audience queries at once and the rest in FIFO order", async () => {
			const { held, reaching } = heldAudiences()
			const { deps, state, audience } = fakeDeps(reaching)
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W)

			for (let i = 1; i <= 5; i++) state.onNotify!(notice({ a: artifactId(i) }))
			await tick()
			expect(audience).toHaveBeenCalledTimes(3)

			held[0]!.resolve([member(ALICE)])
			await tick(0)
			expect(audience).toHaveBeenCalledTimes(4)
			expect(audience.mock.calls.map((call) => call[0])).toEqual([1, 2, 3, 4].map(artifactId))
			expect(alice.events).toEqual([{ topic: "current", artifactId: artifactId(1) }])

			held[1]!.resolve([])
			held[2]!.resolve([])
			await tick(0)
			expect(audience).toHaveBeenCalledTimes(5)
		})

		it("drops one workspace's overflowing backlog for a single resync and leaves other workspaces' queued work", async () => {
			const { held, reaching } = heldAudiences()
			const { deps, state, audience } = fakeDeps(reaching)
			const feed = await createChangeFeed(deps, { logger })
			const inWorkspace = connect(feed, ALICE, W)
			const elsewhere = connect(feed, BOB, W2)

			for (let i = 1; i <= 3; i++) state.onNotify!(notice({ a: artifactId(i) }))
			state.onNotify!(notice({ w: W2, a: artifactId(4) }))
			for (let i = 5; i <= 205; i++) state.onNotify!(notice({ a: artifactId(i) }))
			await tick()

			expect(audience).toHaveBeenCalledTimes(3)
			expect(inWorkspace.events).toEqual([RESYNC])
			expect(elsewhere.events).toEqual([])
			expect(logger.warn).toHaveBeenCalledTimes(1)

			held[0]!.resolve([])
			await tick(0)
			expect(audience).toHaveBeenCalledTimes(4)
			expect(audience).toHaveBeenLastCalledWith(artifactId(4), W2)

			held[1]!.resolve([])
			held[2]!.resolve([])
			held[3]!.resolve([])
			await tick(0)
			expect(audience).toHaveBeenCalledTimes(4)
		})

		it("logs and drops a notice when the audience query fails, and still serves the next one", async () => {
			const { deps, state, audience } = fakeDeps(answer(member(ALICE)))
			audience.mockRejectedValueOnce(new Error("db down"))
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W)

			state.onNotify!(notice({}))
			await tick()
			expect(logger.error).toHaveBeenCalledTimes(1)
			expect(alice.events).toEqual([])

			state.onNotify!(notice({ a: ARTIFACT_2 }))
			await tick()
			expect(alice.events).toEqual([{ topic: "current", artifactId: ARTIFACT_2 }])
		})
	})

	describe("a named audience", () => {
		it("reaches those people in whichever workspace their sessions act, at once, with no audience query", async () => {
			const { deps, state, audience } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const bobHere = connect(feed, BOB, W)
			const bobAway = connect(feed, BOB, W2)
			const alice = connect(feed, ALICE, W)

			state.onNotify!(notice({ t: "removed", u: [BOB, GHOST] }))

			const removed: LiveEvent[] = [{ topic: "removed", artifactId: ARTIFACT }]
			expect(bobHere.events).toEqual(removed)
			expect(bobAway.events).toEqual(removed)
			expect(alice.events).toEqual([])
			await tick()
			expect(audience).not.toHaveBeenCalled()
		})

		it("sends an Access Request notice to the named Owner only", async () => {
			const { deps, state, audience } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W)
			const bob = connect(feed, BOB, W)

			state.onNotify!(notice({ t: "accessRequests", u: [ALICE] }))

			expect(alice.events).toEqual([{ topic: "accessRequests", artifactId: ARTIFACT }])
			expect(bob.events).toEqual([])
			await tick()
			expect(audience).not.toHaveBeenCalled()
			expect(logger.warn).not.toHaveBeenCalled()
		})
	})

	describe("a workspace-wide notice", () => {
		it("fans a Project change out to the streams whose session acts in the workspace, naming no Project", async () => {
			const { deps, state, audience } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W)
			const bobHere = connect(feed, BOB, W)
			const bobAway = connect(feed, BOB, W2)
			const carol = connect(feed, CAROL, W2)

			state.onNotify!(notice({ t: "project", a: null }))

			const expected = [{ topic: "project", artifactId: null }]
			expect(alice.events).toEqual(expected)
			expect(bobHere.events).toEqual(expected)
			expect(bobAway.events).toEqual([])
			expect(carol.events).toEqual([])
			await tick()
			expect(audience).not.toHaveBeenCalled()
		})

		it("sends a workspace resync to the streams acting in that workspace only", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W)
			const bob = connect(feed, BOB, W2)

			state.onNotify!(notice({ t: "resync", a: null, p: null }))

			expect(alice.events).toEqual([RESYNC])
			expect(bob.events).toEqual([])
		})
	})

	describe("a session switch", () => {
		it("moves every stream of that session to its new workspace with a resync, and leaves the person's other sessions", async () => {
			const { deps, state, audience } = fakeDeps(answer(member(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const tabOne = connect(feed, ALICE, W, SESSION_1)
			const tabTwo = connect(feed, ALICE, W, SESSION_1)
			const otherSession = connect(feed, ALICE, W, SESSION_2)

			state.onNotify!(switched(SESSION_1, W2))

			expect(tabOne.events).toEqual([RESYNC])
			expect(tabTwo.events).toEqual([RESYNC])
			expect(otherSession.events).toEqual([])
			expect(audience).not.toHaveBeenCalled()

			state.onNotify!(notice({ w: W2 }))
			await tick()
			expect(tabOne.events).toEqual([RESYNC, CURRENT])
			expect(tabTwo.events).toEqual([RESYNC, CURRENT])
			expect(otherSession.events).toEqual([])

			state.onNotify!(notice({ w: W, a: ARTIFACT_2 }))
			await tick()
			expect(tabOne.events).toEqual([RESYNC, CURRENT])
			expect(tabTwo.events).toEqual([RESYNC, CURRENT])
			expect(otherSession.events).toEqual([{ topic: "current", artifactId: ARTIFACT_2 }])
		})

		it("ignores a switch for a session with no open stream", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W, SESSION_1)

			expect(() => state.onNotify!(switched(SESSION_UNKNOWN, W2))).not.toThrow()

			expect(alice.events).toEqual([])
			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("stops moving a stream that has unsubscribed", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const closed = connect(feed, ALICE, W, SESSION_1)
			const open = connect(feed, ALICE, W, SESSION_1)
			closed.close()

			state.onNotify!(switched(SESSION_1, W2))

			expect(closed.events).toEqual([])
			expect(open.events).toEqual([RESYNC])
		})
	})

	describe("Links", () => {
		it("fires each Link's onGone once, never reaches user feeds, and drops the handler", async () => {
			const { deps, state, audience } = fakeDeps(answer(member(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const link = linkHandlers()
			feed.subscribeLink(LINK, link)
			const alice = connect(feed, ALICE, W)

			state.onNotify!(notice({ t: "link", l: [LINK] }))
			state.onNotify!(notice({ t: "link", l: [LINK] }))
			await tick()

			expect(link.onGone).toHaveBeenCalledTimes(1)
			expect(link.onReset).not.toHaveBeenCalled()
			expect(alice.events).toEqual([])
			expect(audience).not.toHaveBeenCalled()
		})

		it("fires Link handlers for a removed Artifact and still tells its readers", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const link = linkHandlers()
			feed.subscribeLink(LINK, link)
			const alice = connect(feed, ALICE, W)

			state.onNotify!(notice({ t: "removed", u: [ALICE], l: [LINK] }))

			expect(link.onGone).toHaveBeenCalledTimes(1)
			expect(alice.events).toEqual([{ topic: "removed", artifactId: ARTIFACT }])
		})

		it("stops calling an unsubscribed Link or user handler", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const link = linkHandlers()
			const onEvent = vi.fn()
			feed.subscribeLink(LINK, link)()
			feed.subscribeUser({ userId: ALICE, sessionId: SESSION_1, workspaceId: W }, onEvent)()

			state.onNotify!(notice({ t: "link", l: [LINK] }))
			state.onNotify!(notice({ u: [ALICE] }))
			state.onNotify!(switched(SESSION_1, W2))
			state.onListen!()
			await tick()

			expect(link.onGone).not.toHaveBeenCalled()
			expect(link.onReset).not.toHaveBeenCalled()
			expect(onEvent).not.toHaveBeenCalled()
		})
	})

	it("drops malformed payloads with a warning and keeps working", async () => {
		const { deps, state } = fakeDeps()
		const feed = await createChangeFeed(deps, { logger })
		const alice = connect(feed, ALICE, W, SESSION_1)

		expect(() => state.onNotify!("not json")).not.toThrow()
		expect(() => state.onNotify!(JSON.stringify({ w: "nope", t: "current" }))).not.toThrow()
		expect(() => state.onNotify!(notice({ t: "unknown" as ChangeNotice["t"] }))).not.toThrow()
		expect(() => state.onNotify!(switched("nope", W2))).not.toThrow()
		await tick()
		expect(logger.warn).toHaveBeenCalledTimes(4)
		expect(alice.events).toEqual([])

		state.onNotify!(notice({ u: [ALICE] }))
		expect(alice.events).toHaveLength(1)
	})

	it("on a LISTEN reconnect, resyncs every stream in every workspace and resets every Link once; not on first connect or subscribe", async () => {
		const { deps, state } = fakeDeps()
		const feed = await createChangeFeed(deps, { logger })
		const link = linkHandlers()
		const otherLink = linkHandlers()
		const alice = connect(feed, ALICE, W)
		const bob = connect(feed, BOB, W2)
		feed.subscribeLink(LINK, link)
		feed.subscribeLink(LINK, otherLink)
		expect(alice.events).toEqual([])

		state.onListen!()

		expect(alice.events).toEqual([RESYNC])
		expect(bob.events).toEqual([RESYNC])
		expect(link.onReset).toHaveBeenCalledTimes(1)
		expect(otherLink.onReset).toHaveBeenCalledTimes(1)
		expect(link.onGone).not.toHaveBeenCalled()

		// Reset Links are dropped: neither a later revoke nor a second reconnect reaches them.
		state.onNotify!(notice({ t: "link", l: [LINK] }))
		state.onListen!()
		expect(link.onGone).not.toHaveBeenCalled()
		expect(link.onReset).toHaveBeenCalledTimes(1)
	})

	describe("quietMs", () => {
		const alice = { userId: ALICE, workspaceId: W }
		const bob = { userId: BOB, workspaceId: W }

		it("is 0 until the feed is listening, then counts from the first LISTEN", async () => {
			const { deps, state } = fakeDeps(answer(), { listening: false })
			const feed = await createChangeFeed(deps, { logger })
			expect(feed.isListening()).toBe(false)
			await tick(5000)
			expect(feed.quietMs(alice)).toBe(0)

			state.onListen!()
			expect(feed.quietMs(alice)).toBe(0)
			await tick(1000)
			expect(feed.quietMs(alice)).toBe(1000)
		})

		it("counts from the start of listening for a workspace that has had no notice", async () => {
			const { deps } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			expect(feed.quietMs(alice)).toBe(0)
			await tick(5000)
			expect(feed.quietMs(alice)).toBe(5000)
		})

		it("restarts on receipt of any notice for the person's workspace, before coalescing, and only for it", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			await tick(5000)
			// Nobody is subscribed and the notice still sits in its window: it counts all the same.
			state.onNotify!(notice({}))
			expect(feed.quietMs(alice)).toBe(0)
			expect(feed.quietMs({ userId: ALICE, workspaceId: W2 })).toBe(5000)
			await tick(1000)
			state.onNotify!(notice({ t: "link", a: null, l: [LINK] }))
			expect(feed.quietMs(alice)).toBe(0)
			await tick(2000)
			expect(feed.quietMs(alice)).toBe(2000)
			expect(feed.quietMs({ userId: ALICE, workspaceId: W2 })).toBe(8000)
		})

		it("ignores a malformed notice", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			await tick(3000)
			state.onNotify!("{")
			state.onNotify!(JSON.stringify({ w: W }))
			expect(feed.quietMs(alice)).toBe(3000)
		})

		it("is not restarted by a session switch or a web deploy, which are no workspace's change", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			connect(feed, ALICE, W, SESSION_1)
			await tick(5000)

			state.onNotify!(switched(SESSION_1, W2))
			state.onNotify!(WEB_DEPLOYED_NOTICE)

			expect(feed.quietMs(alice)).toBe(5000)
			expect(feed.quietMs({ userId: ALICE, workspaceId: W2 })).toBe(5000)
		})

		it("is 0 while a change for another workspace waits for its audience, in its window or running", async () => {
			const { held, reaching } = heldAudiences()
			const { deps, state } = fakeDeps(reaching)
			const feed = await createChangeFeed(deps, { logger })
			connect(feed, ALICE, W)
			await tick(5000)

			state.onNotify!(notice({ w: W2 }))
			expect(feed.quietMs(alice)).toBe(0)

			await tick()
			expect(held).toHaveLength(1)
			expect(feed.quietMs(alice)).toBe(0)

			held[0]!.resolve([])
			await tick(0)
			expect(feed.quietMs(alice)).toBe(5250)
		})

		it("is 0 while a change for another workspace is queued behind work for the person's own", async () => {
			const { held, reaching } = heldAudiences()
			const { deps, state } = fakeDeps(reaching)
			const feed = await createChangeFeed(deps, { logger, maxReachQueries: 1 })
			connect(feed, ALICE, W)
			await tick(5000)

			state.onNotify!(notice({}))
			state.onNotify!(notice({ w: W2, a: ARTIFACT_2 }))
			await tick()
			expect(held).toHaveLength(1)
			expect(held[0]!.workspaceId).toBe(W)
			expect(feed.quietMs(alice)).toBe(0)

			held[0]!.resolve([])
			await tick(0)
			expect(held).toHaveLength(2)
			expect(feed.quietMs(alice)).toBe(0)

			held[1]!.resolve([])
			await tick(0)
			expect(feed.quietMs(alice)).toBe(250)
		})

		it("after a change for another workspace reaches the person as a Guest, counts from that delivery", async () => {
			const { deps, state } = fakeDeps(answer(guest(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const stream = connect(feed, ALICE, W)
			const bystander = connect(feed, BOB, W)
			await tick(5000)

			state.onNotify!(notice({ w: W2 }))
			await tick()
			expect(stream.events).toEqual([CURRENT])
			expect(bystander.events).toEqual([])
			expect(feed.quietMs(alice)).toBe(0)

			await tick(1000)
			expect(feed.quietMs(alice)).toBe(1000)
			expect(feed.quietMs(bob)).toBe(6250)
		})

		it("is not restarted for a member who does not hear a change of another workspace", async () => {
			const { deps, state } = fakeDeps(answer(member(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const stream = connect(feed, ALICE, W)
			await tick(5000)

			state.onNotify!(notice({ w: W2 }))
			await tick()

			expect(stream.events).toEqual([])
			expect(feed.quietMs(alice)).toBe(5250)
		})

		it("restarts for the people a named audience reaches, in any workspace, and only for them", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const stream = connect(feed, ALICE, W)
			connect(feed, BOB, W)
			await tick(5000)

			state.onNotify!(notice({ w: W2, t: "removed", u: [ALICE] }))
			expect(stream.events).toHaveLength(1)
			expect(feed.quietMs(alice)).toBe(0)
			await tick(1000)

			expect(feed.quietMs(alice)).toBe(1000)
			expect(feed.quietMs(bob)).toBe(6000)
		})

		it("restarts every workspace's count on a LISTEN reconnect", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const inW2 = { userId: ALICE, workspaceId: W2 }
			await tick(5000)
			state.onNotify!(notice({ w: W2, a: null }))
			await tick(5000)
			expect(feed.quietMs(alice)).toBe(10_000)
			expect(feed.quietMs(inW2)).toBe(5000)

			state.onListen!()
			expect(feed.quietMs(alice)).toBe(0)
			expect(feed.quietMs(inW2)).toBe(0)
			await tick(1000)
			expect(feed.quietMs(alice)).toBe(1000)
			expect(feed.quietMs(inW2)).toBe(1000)
		})

		it("is 0 once closed", async () => {
			const { deps } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			await tick(5000)
			await feed.close()
			expect(feed.quietMs(alice)).toBe(0)
		})
	})

	describe("two streams of one person", () => {
		it("each hear a change the person reaches", async () => {
			const { deps, state } = fakeDeps(answer(member(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const first = connect(feed, ALICE, W)
			const second = connect(feed, ALICE, W)

			state.onNotify!(notice({}))
			await tick()

			expect(first.events).toEqual([CURRENT])
			expect(second.events).toEqual([CURRENT])
		})

		it("leave the other stream receiving when one unsubscribes", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const first = connect(feed, ALICE, W)
			const second = connect(feed, ALICE, W)
			first.close()

			state.onNotify!(notice({ u: [ALICE] }))

			expect(first.events).toEqual([])
			expect(second.events).toEqual([CURRENT])
		})

		it("keep the person's last delivery until the last stream unsubscribes", async () => {
			const { deps, state } = fakeDeps(answer(guest(ALICE)))
			const feed = await createChangeFeed(deps, { logger })
			const person = { userId: ALICE, workspaceId: W }
			const first = connect(feed, ALICE, W)
			const second = connect(feed, ALICE, W)
			await tick(5000)
			state.onNotify!(notice({ w: W2 }))
			await tick(1250)
			expect(feed.quietMs(person)).toBe(1000)

			first.close()
			expect(feed.quietMs(person)).toBe(1000)

			second.close()
			connect(feed, ALICE, W)
			expect(feed.quietMs(person)).toBe(6250)
		})
	})

	it("sends webDeployed to every stream in every workspace, with no audience query and no change to quietMs", async () => {
		const { deps, state, audience } = fakeDeps()
		const feed = await createChangeFeed(deps, { logger })
		const alice = connect(feed, ALICE, W)
		const bob = connect(feed, BOB, W2)
		await tick(5_000)
		const quiet = feed.quietMs({ userId: ALICE, workspaceId: W })

		state.onNotify!(WEB_DEPLOYED_NOTICE)

		const expected: LiveEvent[] = [{ topic: "webDeployed", artifactId: null }]
		expect(alice.events).toEqual(expected)
		expect(bob.events).toEqual(expected)
		expect(audience).not.toHaveBeenCalled()
		expect(feed.quietMs({ userId: ALICE, workspaceId: W })).toBe(quiet)
		expect(logger.warn).not.toHaveBeenCalled()
		await feed.close()
	})

	it("close unlistens, stops listening, clears timers and drops every subscriber", async () => {
		const { deps, state, unlisten, audience } = fakeDeps(answer(member(ALICE)))
		const feed = await createChangeFeed(deps, { logger })
		const onEvent = vi.fn()
		const link = linkHandlers()
		feed.subscribeUser({ userId: ALICE, sessionId: SESSION_1, workspaceId: W }, onEvent)
		feed.subscribeLink(LINK, link)
		state.onNotify!(notice({}))
		state.onNotify!(notice({ u: [ALICE] }))
		state.onNotify!(notice({ u: [ALICE] }))

		await feed.close()
		expect(vi.getTimerCount()).toBe(0)
		state.onNotify!(notice({ t: "removed", u: [ALICE], l: [LINK] }))
		state.onNotify!(switched(SESSION_1, W2))
		state.onListen!()
		await tick(1000)

		expect(unlisten).toHaveBeenCalledTimes(1)
		expect(feed.isListening()).toBe(false)
		expect(audience).not.toHaveBeenCalled()
		expect(onEvent).toHaveBeenCalledTimes(1)
		expect(link.onGone).not.toHaveBeenCalled()
		expect(link.onReset).not.toHaveBeenCalled()
	})

	describe("delivery coalescing", () => {
		it("delivers the first event now, collapses a burst, and sends one trailing event", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger, coalesceMs: 250 })
			const alice = connect(feed, ALICE, W)

			for (let i = 0; i < 5; i++) state.onNotify!(notice({ u: [ALICE] }))
			expect(alice.events).toHaveLength(1)

			await tick()
			expect(alice.events).toHaveLength(2)

			await tick()
			expect(alice.events).toHaveLength(2)

			// After a quiet window the next event goes straight through again.
			await tick()
			state.onNotify!(notice({ u: [ALICE] }))
			expect(alice.events).toHaveLength(3)
		})

		it("keeps different topics and Artifacts apart", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const alice = connect(feed, ALICE, W)

			state.onNotify!(notice({ u: [ALICE] }))
			state.onNotify!(notice({ t: "revisions", u: [ALICE] }))
			state.onNotify!(notice({ a: ARTIFACT_2, u: [ALICE] }))

			expect(alice.events).toEqual([
				{ topic: "current", artifactId: ARTIFACT },
				{ topic: "revisions", artifactId: ARTIFACT },
				{ topic: "current", artifactId: ARTIFACT_2 },
			])
		})

		it("coalesces per subscriber, so two tabs of one user each get their own delivery", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const first = vi.fn()
			const second = vi.fn()
			feed.subscribeUser({ userId: ALICE, sessionId: SESSION_1, workspaceId: W }, first)
			feed.subscribeUser({ userId: ALICE, sessionId: SESSION_2, workspaceId: W }, second)

			state.onNotify!(notice({ u: [ALICE] }))
			expect(first).toHaveBeenCalledTimes(1)
			expect(second).toHaveBeenCalledTimes(1)
		})

		it("sends no trailing event after unsubscribe", async () => {
			const { deps, state } = fakeDeps()
			const feed = await createChangeFeed(deps, { logger })
			const onEvent = vi.fn()
			const unsubscribe = feed.subscribeUser({ userId: ALICE, sessionId: SESSION_1, workspaceId: W }, onEvent)

			state.onNotify!(notice({ u: [ALICE] }))
			state.onNotify!(notice({ u: [ALICE] }))
			unsubscribe()
			await tick(1000)

			expect(onEvent).toHaveBeenCalledTimes(1)
			expect(vi.getTimerCount()).toBe(0)
		})
	})
})
