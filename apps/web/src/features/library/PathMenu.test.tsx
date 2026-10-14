import { type Project } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { crumbsFor } from "./PathMenu"

const project = (id: string, name: string, parentProjectId: string | null, ownerId = "u1"): Project => ({
	id,
	workspaceId: "w1",
	ownerId,
	parentProjectId,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name,
	createdAt: new Date("2026-01-01T00:00:00Z"),
})

describe("crumbsFor", () => {
	it("roots a Project at All artifacts and indents each level down to the file's own", () => {
		const projects = [project("p1", "Sales", null), project("p2", "Q4", "p1")]
		const crumbs = crumbsFor({ folder: { kind: "project", id: "p2", name: "Q4" }, projects, meId: "u1" })
		expect(crumbs.map(({ name, href, depth, current }) => ({ name, href, depth, current }))).toEqual([
			{ name: "All artifacts", href: "/", depth: 0, current: false },
			{ name: "Sales", href: "/projects/p1", depth: 1, current: false },
			{ name: "Q4", href: "/projects/p2", depth: 2, current: true },
		])
	})

	it("roots a Project someone else owns at Shared with me", () => {
		const projects = [project("p1", "Theirs", null, "u2")]
		const crumbs = crumbsFor({ folder: { kind: "project", id: "p1", name: "Theirs" }, projects, meId: "u1" })
		expect(crumbs[0]).toMatchObject({ name: "Shared with me", href: "/shared" })
	})

	it("gives a file with no Project the list it came from as its only level", () => {
		const crumbs = crumbsFor({ folder: { kind: "list", name: "My uploads", href: "/mine" }, projects: [], meId: "u1" })
		expect(crumbs).toEqual([{ name: "My uploads", href: "/mine", kind: "list", depth: 0, current: true }])
	})
})
