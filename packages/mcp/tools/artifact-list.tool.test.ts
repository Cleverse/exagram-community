import { describe, expect, it, vi } from "vitest"

import { artifactList } from "./artifact-list.tool"
import { projectList } from "./project-list.tool"

const ctx = (usecase: Record<string, unknown>, folderAccess: "all" | "named" = "all") => ({
	principal: { kind: "connection" as const, id: "c1", folderAccess },
	scopes: ["read"] as const,
	usecase: usecase as never,
})

describe("artifact_list", () => {
	it("passes the principal through and lists what came back", async () => {
		const listArtifacts = vi
			.fn()
			.mockResolvedValue([{ artifactId: "a1", kind: "doc", title: "Pricing", projectId: "p1", revisionId: "r1" }])
		const result = await artifactList(ctx({ listArtifacts }), { limit: 10 })
		expect(listArtifacts).toHaveBeenCalledWith({ kind: "connection", id: "c1", folderAccess: "all" }, { limit: 10 })
		expect(result.content[0]!.text).toContain("a1")
		expect(result.content[0]!.text).toContain("Pricing")
	})

	it("says plainly that nothing is reachable rather than returning an empty list", async () => {
		const result = await artifactList(ctx({ listArtifacts: vi.fn().mockResolvedValue([]) }), {})
		expect(result.content[0]!.text).toContain("No Artifact is available to this Connection")
	})

	it("leads with the folder limit for named lists, including an empty list", async () => {
		for (const artifacts of [[], [{ artifactId: "a1", kind: "doc", title: "A", projectId: "p1", revisionId: "r1" }]]) {
			const result = await artifactList(ctx({ listArtifacts: vi.fn().mockResolvedValue(artifacts) }, "named"), {})
			expect(result.content[0]!.text.split("\n")[0]).toBe(
				"This client is limited to folders its person chose; files outside them are not listed.",
			)
		}
	})
})

describe("project_list", () => {
	it("lists the Projects reached and the access held in each", async () => {
		const listProjects = vi
			.fn()
			.mockResolvedValue([{ projectId: "p1", name: "P", parentProjectId: null, access: "edit" }])
		const result = await projectList(ctx({ listProjects }), {})
		expect(result.content[0]!.text).toContain("p1")
		expect(result.content[0]!.text).toContain("P")
		expect(result.content[0]!.text).toContain("access=edit")
	})

	it("says plainly that nothing is reachable rather than returning an empty list", async () => {
		const result = await projectList(ctx({ listProjects: vi.fn().mockResolvedValue([]) }), {})
		expect(result.content[0]!.text).toContain("owns no Project and holds no Grant")
	})

	it("leads with the folder limit for named project lists, including an empty list", async () => {
		for (const projects of [[], [{ projectId: "p1", name: "P", parentProjectId: null, access: "edit" }]]) {
			const result = await projectList(ctx({ listProjects: vi.fn().mockResolvedValue(projects) }, "named"), {})
			expect(result.content[0]!.text.split("\n")[0]).toBe(
				"This client is limited to folders its person chose; files outside them are not listed.",
			)
		}
	})
})
