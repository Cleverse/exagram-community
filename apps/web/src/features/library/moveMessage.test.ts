import { type Project } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { movedMessage } from "./moveMessage"

const project = (id: string, name: string, parentProjectId: string | null): Project => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name,
	createdAt: new Date("2026-01-01T00:00:00Z"),
})

describe("movedMessage", () => {
	const projects = [project("p1", "Sales", null), project("p2", "Q4", "p1")]

	it("names a sub-Project as project › subfolder", () => {
		expect(movedMessage("Board pack", "p2", projects)).toBe("Moved Board pack to Sales › Q4")
	})

	it("names a top-level Project alone", () => {
		expect(movedMessage("Board pack", "p1", projects)).toBe("Moved Board pack to Sales")
	})

	it("says a file left its project", () => {
		expect(movedMessage("Board pack", null, projects)).toBe("Board pack is no longer in a folder")
	})
})
