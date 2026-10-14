import { type PendingRevision, type VisibleArtifact } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { buildFeed, dayLabel, FEED_LIMIT, feedFor, groupByDay, pendingAuthor } from "./activityFeed"

const NOW = new Date(2026, 8, 14, 12, 0)

const artifact = (over: Partial<VisibleArtifact>): VisibleArtifact => ({
	id: "a1",
	workspaceId: "w1",
	ownerId: "u1",
	projectId: "p1",
	kind: "doc",
	title: "Spec",
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date(2026, 8, 1),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 1,
	updatedAt: new Date(2026, 8, 14, 9, 5),
	ownerName: "Ada Lovelace",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "example.com",
	...over,
})

const pending = (over: Partial<PendingRevision>): PendingRevision => ({
	placeholderTypes: [],
	redactionStatus: "done",
	revisionId: "rev9",
	artifactId: "a1",
	seq: 2,
	authorUserId: "u2",
	authorConnectionId: null,
	mime: "text/markdown",
	bytes: 10,
	note: null,
	createdAt: new Date(2026, 8, 14, 10, 30),
	title: "Spec",
	kind: "doc",
	ownerId: "u1",
	isApprover: true,
	authorName: "Grace Hopper",
	authorConnectionName: null,
	...over,
})

const feed = (input: { artifacts?: VisibleArtifact[]; pending?: PendingRevision[] }) =>
	buildFeed({ artifacts: input.artifacts ?? [], pending: input.pending ?? [], meId: "u1", meInitials: "RC" })

describe("pendingAuthor", () => {
	it("says You for the reader's own upload, never 'a collaborator'", () => {
		expect(pendingAuthor(pending({ authorUserId: "u1", authorName: "Ada" }), "u1")).toBe("You")
	})

	it("names another person by first name", () => {
		expect(pendingAuthor(pending({}), "u1")).toBe("Grace")
	})

	it("names the reader's own Connection by its client alone", () => {
		expect(
			pendingAuthor(
				pending({ authorUserId: "u1", authorConnectionId: "c1", authorConnectionName: "Claude Code" }),
				"u1",
			),
		).toBe("Claude Code")
	})

	it("names someone else's Connection as theirs", () => {
		expect(pendingAuthor(pending({ authorConnectionId: "c1", authorConnectionName: "Claude Code" }), "u1")).toBe(
			"Grace's Claude Code",
		)
		expect(pendingAuthor(pending({ authorConnectionId: "c1", authorConnectionName: null }), "u1")).toBe(
			"Grace's Connection",
		)
	})
})

describe("buildFeed", () => {
	it("turns an Artifact's latest publish into an event, newest first, with its time of day", () => {
		const events = feed({
			artifacts: [
				artifact({ id: "a1", title: "Old", updatedAt: new Date(2026, 8, 12, 8, 0) }),
				artifact({ id: "a2", title: "New", revisionSeq: 3, updatedAt: new Date(2026, 8, 14, 9, 5) }),
			],
		})
		expect(events.map((event) => [event.target, event.tag, event.time])).toEqual([
			["New", "Published v3", "09:05"],
			["Old", "Published v1", "08:00"],
		])
		expect(events[0]).toMatchObject({ who: "You", actor: "RC", mine: true, detail: "Only you" })
	})

	it("credits someone else's file to them and says who else can see it", () => {
		const [event] = feed({
			artifacts: [artifact({ ownerId: "u2", ownerName: "Grace Hopper", sharedWithNames: ["Ada", "Alan"] })],
		})
		expect(event).toMatchObject({ who: "Grace", actor: "GH", mine: false, detail: "Shared with 2 people" })
	})

	it("skips a publish event for an Artifact with nothing approved yet", () => {
		expect(feed({ artifacts: [artifact({ revisionSeq: null, visibleRevisionId: null })] })).toEqual([])
	})

	it("lists a pending submission with what Connections still read", () => {
		const [event] = feed({ artifacts: [artifact({ revisionSeq: 1 })], pending: [pending({})] }).filter(
			(candidate) => candidate.pending,
		)
		expect(event).toMatchObject({
			tag: "v2 needs approval",
			detail: "Connections still read v1",
			who: "Grace",
			mine: false,
		})
	})

	it("counts the reader's own and their Connection's submissions as theirs", () => {
		const events = feed({
			pending: [
				pending({ revisionId: "p1", authorUserId: "u1", authorName: "Ada" }),
				pending({
					revisionId: "p2",
					authorUserId: "u1",
					authorConnectionId: "c1",
					authorConnectionName: "Claude Code",
				}),
			],
		})
		expect(events.map((event) => [event.who, event.mine])).toEqual([
			["You", true],
			["Claude Code", true],
		])
		expect(events[0]?.detail).toBe("Not published yet")
	})

	it("credits a publish to the Owner, who published it, whoever uploaded it", () => {
		const [event] = feed({ artifacts: [artifact({ ownerId: "u2", ownerName: "Grace Hopper", revisionSeq: 4 })] })
		expect(event).toMatchObject({ tag: "Published v4", who: "Grace", mine: false })
	})
})

describe("feedFor", () => {
	it("keeps the newest events of a scope, up to the cap, and counts them all", () => {
		const many = Array.from({ length: FEED_LIMIT + 5 }, (_, index) =>
			artifact({ id: `a${index}`, updatedAt: new Date(2026, 8, 14, 0, index) }),
		)
		const team = feedFor(feed({ artifacts: many }), "team")
		expect(team.events).toHaveLength(FEED_LIMIT)
		expect(team.total).toBe(FEED_LIMIT + 5)
		expect(team.events[0]?.artifactId).toBe(`a${FEED_LIMIT + 4}`)
		expect(team.events.at(-1)?.artifactId).toBe("a5")
	})

	it("filters before capping, so the reader's own events survive a full Team feed", () => {
		const theirs = Array.from({ length: FEED_LIMIT }, (_, index) =>
			artifact({ id: `t${index}`, ownerId: "u2", ownerName: "Grace", updatedAt: new Date(2026, 8, 14, 10, index) }),
		)
		const own = artifact({ id: "mine", updatedAt: new Date(2026, 8, 13, 9) })
		const events = feed({ artifacts: [...theirs, own] })
		expect(feedFor(events, "team").events.map((event) => event.artifactId)).not.toContain("mine")
		expect(feedFor(events, "mine")).toEqual({ events: [expect.objectContaining({ artifactId: "mine" })], total: 1 })
	})
})

describe("days", () => {
	it("puts 23:59 and 00:01 on either side of midnight", () => {
		const events = feed({
			artifacts: [
				artifact({ id: "late", updatedAt: new Date(2026, 8, 13, 23, 59) }),
				artifact({ id: "early", updatedAt: new Date(2026, 8, 14, 0, 1) }),
			],
		})
		expect(groupByDay(events, NOW).map((group) => [group.name, group.events.map((event) => event.artifactId)])).toEqual(
			[
				["Today", ["early"]],
				["Yesterday", ["late"]],
			],
		)
	})

	it("names today and yesterday beside their date, and older days by date alone", () => {
		expect(dayLabel(new Date(2026, 8, 14, 9), NOW)).toEqual({ name: "Today", date: "Mon 14 Sep" })
		expect(dayLabel(new Date(2026, 8, 13, 9), NOW)).toEqual({ name: "Yesterday", date: "Sun 13 Sep" })
		expect(dayLabel(new Date(2026, 8, 11, 9), NOW)).toEqual({ name: "Fri 11 Sep", date: "" })
	})

	it("groups events by calendar day, newest day first", () => {
		const events = feed({
			artifacts: [
				artifact({ id: "a1", updatedAt: new Date(2026, 8, 14, 9) }),
				artifact({ id: "a2", updatedAt: new Date(2026, 8, 14, 8) }),
				artifact({ id: "a3", updatedAt: new Date(2026, 8, 12, 8) }),
			],
		})
		expect(groupByDay(events, NOW).map((group) => [group.key, group.name, group.events.length])).toEqual([
			["2026-09-14", "Today", 2],
			["2026-09-12", "Sat 12 Sep", 1],
		])
	})
})
