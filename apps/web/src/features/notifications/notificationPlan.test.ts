import { type Notification } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import {
	bodyFor,
	firstState,
	loadState,
	type NotifierState,
	OVERLAP_MS,
	pathFor,
	planNotifications,
	saveState,
	SEEN_MAX,
	sinceFor,
	stateKey,
} from "./notificationPlan"

const ART = "00000000-0000-4000-8000-0000000000a1"
const PROJ = "00000000-0000-4000-8000-0000000000b1"

let next = 0
const item = (over: Partial<Omit<Notification, "createdAt">> & { createdAt?: string }): Notification =>
	({
		id: `00000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`,
		kind: "comment",
		artifactId: ART,
		projectId: null,
		title: "Q3 plan",
		actorName: "Ann",
		// JSON delivers timestamps as ISO strings, whatever the contract's `Date` says.
		createdAt: "2026-10-06T10:00:00.000Z",
		...over,
	}) as unknown as Notification

const STATE: NotifierState = { cursor: "2026-10-06T09:00:00.000Z", seen: [] }

const memoryStorage = () => {
	const values = new Map<string, string>()
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
	}
}

describe("notificationPlan", () => {
	it("starts a new device from the server's clock, with nothing seen", () => {
		const start = { cursor: "2026-10-06T09:00:00.000Z", seen: [], floor: "2026-10-06T09:00:00.000Z" }
		expect(firstState("2026-10-06T09:00:00.000Z")).toEqual(start)
		expect(firstState(new Date("2026-10-06T09:00:00Z"))).toEqual(start)
	})

	it("asks two minutes behind the cursor", () => {
		expect(OVERLAP_MS).toBe(120_000)
		expect(sinceFor(STATE).toISOString()).toBe("2026-10-06T08:58:00.000Z")
	})

	it("keeps state per server, member and Workspace, and treats missing, broken or foreign storage as no state", () => {
		expect(stateKey("https://api.example.test", "u1", "w1")).not.toBe(stateKey("https://api.example.test", "u2", "w1"))
		expect(stateKey("https://a.example.test", "u1", "w1")).not.toBe(stateKey("https://b.example.test", "u1", "w1"))
		expect(stateKey("https://api.example.test", "u1", "w1")).not.toBe(stateKey("https://api.example.test", "u1", "w2"))
		const storage = memoryStorage()
		expect(loadState(storage, "k")).toBeNull()
		// State saved before `floor` existed still loads, with no floor.
		saveState(storage, "k", STATE)
		expect(loadState(storage, "k")).toEqual(STATE)
		expect(loadState(storage, "k")).not.toHaveProperty("floor")
		saveState(storage, "k", { ...STATE, floor: STATE.cursor })
		expect(loadState(storage, "k")).toEqual({ ...STATE, floor: STATE.cursor })
		storage.setItem("k", JSON.stringify({ ...STATE, floor: "never" }))
		expect(loadState(storage, "k")).toEqual(STATE)
		storage.setItem("k", "not json")
		expect(loadState(storage, "k")).toBeNull()
		storage.setItem("k", JSON.stringify({ cursor: "yesterday", seen: [] }))
		expect(loadState(storage, "k")).toBeNull()
		storage.setItem("k", JSON.stringify({ cursor: STATE.cursor, seen: [1] }))
		expect(loadState(storage, "k")).toBeNull()
		const throwing = {
			getItem: () => {
				throw new Error("blocked")
			},
			setItem: () => {
				throw new Error("blocked")
			},
		}
		expect(loadState(throwing, "k")).toBeNull()
		expect(() => saveState(throwing, "k", STATE)).not.toThrow()
	})

	it("posts each new item and moves the cursor to the newest createdAt returned", () => {
		const a = item({ createdAt: "2026-10-06T09:30:00.000Z" })
		const b = item({ createdAt: "2026-10-06T09:45:00.000Z" })
		const plan = planNotifications(STATE, [a, b])
		expect(plan.notices.map((notice) => notice.id)).toEqual([`comment:${a.id}`, `comment:${b.id}`])
		expect(plan.state).toEqual({ cursor: "2026-10-06T09:45:00.000Z", seen: [`comment:${a.id}`, `comment:${b.id}`] })
	})

	it("drops what the overlap returns again, and never moves the cursor back", () => {
		const old = item({ createdAt: "2026-10-06T08:59:00.000Z" })
		const first = planNotifications(STATE, [old])
		expect(first.notices).toHaveLength(1)
		expect(first.state.cursor).toBe(STATE.cursor)

		const fresh = item({ createdAt: "2026-10-06T09:01:00.000Z" })
		const second = planNotifications(first.state, [old, fresh])
		expect(second.notices.map((notice) => notice.id)).toEqual([`comment:${fresh.id}`])
		expect(second.state.cursor).toBe("2026-10-06T09:01:00.000Z")

		expect(planNotifications(second.state, [old, fresh]).notices).toEqual([])
		expect(planNotifications(STATE, []).state).toEqual(STATE)
	})

	it("keys by kind and id, so the same id under another kind is new", () => {
		const id = "00000000-0000-4000-8000-0000000000ff"
		const plan = planNotifications({ ...STATE, seen: [`comment:${id}`] }, [
			item({ id, kind: "comment" }),
			item({ id, kind: "grant" }),
		])
		expect(plan.notices.map((notice) => notice.id)).toEqual([`grant:${id}`])
	})

	it("remembers only the last 200 keys", () => {
		const seen = Array.from({ length: SEEN_MAX }, (_, index) => `comment:old-${index}`)
		const fresh = item({})
		const plan = planNotifications({ ...STATE, seen }, [fresh])
		expect(plan.state.seen).toHaveLength(SEEN_MAX)
		expect(plan.state.seen.at(-1)).toBe(`comment:${fresh.id}`)
		expect(plan.state.seen[0]).toBe("comment:old-1")
	})

	it("says who did what, by kind", () => {
		expect(bodyFor(item({ kind: "accessRequest" }))).toBe("Ann asked for access")
		expect(bodyFor(item({ kind: "pendingRevision" }))).toBe("Ann sent a revision for your approval")
		expect(bodyFor(item({ kind: "grant" }))).toBe("Ann shared this with you")
		expect(bodyFor(item({ kind: "grant", artifactId: null, projectId: PROJ }))).toBe("Ann shared this folder with you")
		// A sharer the caller may not see comes as null, and no body ever reads "null".
		expect(bodyFor(item({ kind: "grant", actorName: null }))).toBe("Shared with you")
		expect(bodyFor(item({ kind: "grant", artifactId: null, projectId: PROJ, actorName: null }))).toBe(
			"A folder was shared with you",
		)
		// The same words as the iPhone app.
		expect(bodyFor(item({ kind: "accessRequest", actorName: null }))).toBe("Someone asked for access")
		expect(bodyFor(item({ kind: "pendingRevision", actorName: null }))).toBe("A revision is waiting for your approval")
		expect(bodyFor(item({ kind: "comment", actorName: null }))).toBe("New comment")
		expect(bodyFor(item({ kind: "comment" }))).toBe("Ann commented")
		const notice = planNotifications(STATE, [item({ kind: "comment", title: "Board deck" })]).notices[0]
		expect(notice?.title).toBe("Board deck")
		expect(notice?.body).toBe("Ann commented")
	})

	it("opens Activity for requests and approvals, the file or folder for a grant, the file for a comment", () => {
		expect(pathFor(item({ kind: "accessRequest" }))).toBe("/activity")
		expect(pathFor(item({ kind: "pendingRevision" }))).toBe("/activity")
		expect(pathFor(item({ kind: "grant" }))).toBe(`/artifacts/${ART}`)
		expect(pathFor(item({ kind: "grant", artifactId: null, projectId: PROJ }))).toBe(`/projects/${PROJ}`)
		expect(pathFor(item({ kind: "comment" }))).toBe(`/artifacts/${ART}`)
	})

	it("posts up to three items one by one, and more than three as one summary", () => {
		const three = [item({}), item({}), item({})]
		expect(planNotifications(STATE, three).notices).toHaveLength(3)

		const four = [...three, item({ createdAt: "2026-10-06T10:05:00.000Z" })]
		const plan = planNotifications(STATE, four)
		expect(plan.notices).toEqual([
			{
				id: "summary:2026-10-06T10:05:00.000Z",
				title: "Exagram",
				body: "4 new items in Activity",
				path: "/activity",
			},
		])
		expect(plan.state.seen).toHaveLength(4)
	})

	it("counts only the new items toward the summary", () => {
		const repeated = [item({}), item({}), item({})]
		const seen = repeated.map((entry) => `${entry.kind}:${entry.id}`)
		const plan = planNotifications({ ...STATE, seen }, [...repeated, item({})])
		expect(plan.notices).toHaveLength(1)
		expect(plan.notices[0]?.body).toBe("Ann commented")
	})

	it("never posts or counts anything at or before the first run's floor, but remembers it", () => {
		const floored: NotifierState = { cursor: "2026-10-06T09:00:00.000Z", seen: [], floor: "2026-10-06T09:00:00.000Z" }
		const before = [
			item({ createdAt: "2026-10-06T08:59:00.000Z" }),
			item({ createdAt: "2026-10-06T08:59:30.000Z" }),
			item({ createdAt: "2026-10-06T09:00:00.000Z" }),
			item({ createdAt: "2026-10-06T08:58:00.000Z" }),
		]
		const after = item({ createdAt: "2026-10-06T09:00:01.000Z" })
		const plan = planNotifications(floored, [...before, after])
		// Five new keys, but only one is past the floor: posted on its own, not summarised.
		expect(plan.notices.map((notice) => notice.id)).toEqual([`comment:${after.id}`])
		expect(plan.state.seen).toHaveLength(5)
		expect(plan.state.floor).toBe(floored.floor)
		expect(plan.state.cursor).toBe("2026-10-06T09:00:01.000Z")
	})

	it("remembers a kind this build does not know, and never posts or counts it", () => {
		const unknown = [1, 2, 3, 4].map(() => item({ kind: "reaction" as Notification["kind"] }))
		const known = item({})
		const plan = planNotifications(STATE, [...unknown, known])
		expect(plan.notices.map((notice) => notice.id)).toEqual([`comment:${known.id}`])
		expect(plan.state.seen).toHaveLength(5)
		expect(plan.state.seen[0]).toBe(`reaction:${unknown[0]?.id}`)
		expect(planNotifications(plan.state, unknown).notices).toEqual([])
	})
})
