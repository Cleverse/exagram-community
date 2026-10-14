import { type VisibleArtifact } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { groupArtifactsByRecency } from "./grouping"

const daysAgo = (days: number) => {
	const date = new Date()
	date.setHours(12, 0, 0, 0)
	date.setDate(date.getDate() - days)
	return date
}

const artifact = (id: string, updatedAt: Date): VisibleArtifact => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	projectId: null,
	kind: "doc",
	title: id,
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: updatedAt,
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 1,
	updatedAt,
	ownerName: "owner",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "northwind.example",
})

describe("groupArtifactsByRecency", () => {
	it("splits the five recency buckets and returns them in order", () => {
		const groups = groupArtifactsByRecency([
			artifact("older", daysAgo(40)),
			artifact("lastWeek", daysAgo(10)),
			artifact("earlierThisWeek", daysAgo(4)),
			artifact("yesterday", daysAgo(1)),
			artifact("today", daysAgo(0)),
		])

		expect(groups.map((group) => group.label)).toEqual([
			"Today",
			"Yesterday",
			"Earlier this week",
			"Last week",
			"Older",
		])
		expect(groups.map((group) => group.artifacts.map((item) => item.id))).toEqual([
			["today"],
			["yesterday"],
			["earlierThisWeek"],
			["lastWeek"],
			["older"],
		])
	})

	it("puts the bucket edges on the day they belong to", () => {
		const groups = groupArtifactsByRecency([artifact("a", daysAgo(7)), artifact("b", daysAgo(8))])
		expect(groups.map((group) => group.label)).toEqual(["Earlier this week", "Last week"])

		const older = groupArtifactsByRecency([artifact("c", daysAgo(14)), artifact("d", daysAgo(15))])
		expect(older.map((group) => group.label)).toEqual(["Last week", "Older"])
	})

	it("drops empty buckets and keeps same-bucket artifacts in their given order", () => {
		const groups = groupArtifactsByRecency([artifact("a", daysAgo(0)), artifact("b", daysAgo(0))])

		expect(groups).toHaveLength(1)
		expect(groups[0]?.label).toBe("Today")
		expect(groups[0]?.artifacts.map((item) => item.id)).toEqual(["a", "b"])
	})
})
