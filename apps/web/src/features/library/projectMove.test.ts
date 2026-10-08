import { type Project } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { canMoveProject, projectMovedMessage } from "./projectMove"

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

describe("canMoveProject", () => {
	const sales = project("p1", "Sales", null)
	const q4 = project("p2", "Q4", "p1")
	const legal = project("p3", "Legal", null)
	const theirs = project("p4", "Theirs", null, "u2")
	const projects = [sales, q4, legal, theirs]

	it("nests a top-level Project without folders under another you own", () => {
		expect(canMoveProject(projects, legal, "p1", "u1")).toBe(true)
	})

	it("moves a folder to another top-level Project, or to the top level", () => {
		expect(canMoveProject(projects, q4, "p3", "u1")).toBe(true)
		expect(canMoveProject(projects, q4, null, "u1")).toBe(true)
	})

	it("refuses a move that changes nothing", () => {
		expect(canMoveProject(projects, q4, "p1", "u1")).toBe(false)
		expect(canMoveProject(projects, legal, null, "u1")).toBe(false)
	})

	it("refuses a Project into itself", () => {
		expect(canMoveProject(projects, legal, "p3", "u1")).toBe(false)
	})

	it("keeps depth at one: no parent for a Project with folders, no folder as a parent", () => {
		expect(canMoveProject(projects, sales, "p3", "u1")).toBe(false)
		expect(canMoveProject(projects, legal, "p2", "u1")).toBe(false)
	})

	it("moves only your own Project, only into your own", () => {
		expect(canMoveProject(projects, theirs, "p1", "u1")).toBe(false)
		expect(canMoveProject(projects, legal, "p4", "u1")).toBe(false)
		expect(canMoveProject(projects, legal, "p1", undefined)).toBe(false)
	})
})

describe("projectMovedMessage", () => {
	const projects = [project("p1", "Sales", null)]

	it("names the new parent", () => {
		expect(projectMovedMessage("Q4", "p1", projects)).toBe("Moved Q4 into Sales")
	})

	it("says the Project left its parent", () => {
		expect(projectMovedMessage("Q4", null, projects)).toBe("Q4 is now a top-level project")
	})
})
