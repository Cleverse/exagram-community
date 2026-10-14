import { describe, expect, it, vi } from "vitest"

import { UNTRUSTED_PREAMBLE } from "../untrusted"

import { artifactSearch } from "./artifact-search.tool"

const hit = {
	artifactId: "11111111-1111-4111-8111-111111111111",
	kind: "doc",
	title: "Pricing memo",
	projectId: "33333333-3333-4333-8333-333333333333",
	revisionId: "22222222-2222-4222-8222-222222222222",
	detectorVersion: null,
	snippet: "quarterly <<revenue>> forecast",
}

const ctx = (searchArtifacts: unknown, folderAccess: "all" | "named" = "all") => ({
	principal: { kind: "connection" as const, id: "c1", folderAccess },
	scopes: ["read"] as const,
	usecase: { searchArtifacts } as never,
})

describe("artifact_search", () => {
	it("wraps every snippet in the untrusted envelope", async () => {
		const searchArtifacts = vi.fn().mockResolvedValue([hit])

		const result = await artifactSearch(ctx(searchArtifacts), { query: "revenue" })

		expect(searchArtifacts).toHaveBeenCalledWith(
			{ kind: "connection", id: "c1", folderAccess: "all" },
			{ query: "revenue", limit: 20 },
		)
		expect(result.content[0]!.text).toContain(UNTRUSTED_PREAMBLE)
		expect(result.content[0]!.text).toContain(`<untrusted_document id="${hit.artifactId}">`)
		expect(result.content[0]!.text).toContain("quarterly <<revenue>> forecast")
	})

	it("passes a project_id through without deciding anything about it itself", async () => {
		const searchArtifacts = vi.fn().mockResolvedValue([])

		await artifactSearch(ctx(searchArtifacts), {
			query: "revenue",
			project_id: "33333333-3333-4333-8333-333333333333",
		})

		expect(searchArtifacts).toHaveBeenCalledWith(
			{ kind: "connection", id: "c1", folderAccess: "all" },
			{ query: "revenue", projectId: "33333333-3333-4333-8333-333333333333", limit: 20 },
		)
	})

	it("says the same sentence for no match and for a Project this Connection cannot reach", async () => {
		const empty = ctx(vi.fn().mockResolvedValue([]))

		const noMatch = await artifactSearch(empty, { query: "nothing" })
		const foreign = await artifactSearch(empty, {
			query: "nothing",
			project_id: "99999999-9999-4999-8999-999999999999",
		})

		expect(noMatch.content[0]!.text).toBe(
			'Nothing this Connection reaches matches "nothing". Search covers Artifact titles and Extracted Text.',
		)
		expect(foreign.content[0]!.text).toBe(noMatch.content[0]!.text)
	})

	it("leads with the folder limit for named searches, with or without hits", async () => {
		for (const hits of [[], [hit]]) {
			const result = await artifactSearch(ctx(vi.fn().mockResolvedValue(hits), "named"), { query: "revenue" })
			expect(result.content[0]!.text.split("\n")[0]).toBe(
				"This client is limited to folders its person chose; files outside them are not listed.",
			)
		}
	})

	it("refuses an empty query through the schema", async () => {
		await expect(artifactSearch(ctx(vi.fn()), { query: "" })).rejects.toThrow()
	})
})
