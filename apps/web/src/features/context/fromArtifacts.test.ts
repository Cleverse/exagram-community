import { type VisibleArtifact } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { recapFileOf } from "./fromArtifacts"

const artifact: VisibleArtifact = {
	id: "a1",
	workspaceId: "w1",
	ownerId: "u1",
	projectId: "p1",
	kind: "html",
	title: "Landing page",
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date("2026-09-01T00:00:00Z"),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 3,
	updatedAt: new Date(2026, 8, 15, 9, 30),
	ownerName: "nina",
	sharedCount: 2,
	sharedWithNames: ["ada", "omar"],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Example Co",
	orgDomain: "example.com",
}

describe("recapFileOf", () => {
	it("reads an artifact as whole days back from the day it is given", () => {
		expect(recapFileOf(artifact, new Date(2026, 8, 17, 1, 0))).toEqual({
			id: "a1",
			name: "Landing page",
			type: "html",
			rev: "v3",
			updated: "2d",
			projectId: "p1",
			owner: "nina",
			shared: ["nina", "ada", "omar"],
		})
	})

	it("calls an artifact without a revision v1, and a future date today", () => {
		const row = recapFileOf({ ...artifact, revisionSeq: null }, new Date(2026, 8, 14))
		expect(row.rev).toBe("v1")
		expect(row.updated).toBe("0d")
	})
})
