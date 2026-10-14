import { type VisibleArtifact, type VisibleProject } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { projectsOverview } from "./projectsOverview"

const project = (id: string, over: Partial<VisibleProject> = {}): VisibleProject => ({
	id,
	workspaceId: "w1",
	ownerId: "me",
	name: id,
	parentProjectId: null,
	publishPolicy: "manual",
	linkPreview: "metadata",
	createdAt: new Date(2026, 0, 1),
	ownerName: "Me",
	memberNames: [],
	...over,
})

const artifact = (id: string, projectId: string | null, over: Partial<VisibleArtifact> = {}) =>
	({ id, projectId, updatedAt: new Date(2026, 0, 1), sharedWithNames: [], ...over }) as VisibleArtifact

describe("projectsOverview", () => {
	it("lists top-level Projects with subfolder files folded in, newest activity first", () => {
		const rows = projectsOverview(
			[project("old"), project("new"), project("child", { parentProjectId: "old" })],
			[
				artifact("a1", "old", { updatedAt: new Date(2026, 1, 1) }),
				artifact("a2", "child", { updatedAt: new Date(2026, 5, 1) }),
				artifact("a3", "new", { updatedAt: new Date(2026, 3, 1) }),
				artifact("a4", null, { updatedAt: new Date(2026, 8, 1) }),
			],
			"me",
		)
		expect(rows.map((row) => [row.project.id, row.files])).toEqual([
			["old", 2],
			["new", 1],
		])
		expect(rows[0]?.lastActivity).toEqual(new Date(2026, 5, 1))
	})

	it("falls back to when the Project was made when it holds no files", () => {
		const [row] = projectsOverview([project("empty", { createdAt: new Date(2026, 2, 3) })], [], "me")
		expect(row?.files).toBe(0)
		expect(row?.lastActivity).toEqual(new Date(2026, 2, 3))
	})

	it("says who reaches each Project", () => {
		const rows = projectsOverview(
			[
				project("solo", { createdAt: new Date(2026, 0, 5) }),
				project("one", { memberNames: ["Grace Hopper"], createdAt: new Date(2026, 0, 4) }),
				project("many", { memberNames: ["Grace", "Alan"], createdAt: new Date(2026, 0, 3) }),
				project("theirs", { ownerId: "u2", ownerName: "Ada", memberNames: null, createdAt: new Date(2026, 0, 2) }),
				project("files", { createdAt: new Date(2025, 0, 1) }),
			],
			[artifact("a1", "files", { updatedAt: new Date(2025, 0, 1), sharedWithNames: ["Grace"] })],
			"me",
		)
		expect(rows.map((row) => [row.project.id, row.access])).toEqual([
			["solo", "Not shared"],
			["one", "Shared with Grace Hopper"],
			["many", "Shared with 2 people"],
			["theirs", "Shared by Ada"],
			["files", "Some files shared"],
		])
	})
})
