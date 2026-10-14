import { describe, expect, it, vi } from "vitest"

import { dispatchTool, TOOL_TABLE } from "./dispatch"
import { BinaryImageReadError } from "./port"
import { TOOL_NAMES } from "./registry"
import { NARROWED_REFUSAL_TEXT } from "./scopes"

const usecase = {
	listArtifacts: vi.fn().mockResolvedValue([]),
	searchArtifacts: vi.fn().mockResolvedValue([]),
	readArtifact: vi.fn().mockResolvedValue({ artifact: null, reason: "out-of-boundary" }),
	listProjects: vi.fn().mockResolvedValue([]),
	upload: vi.fn().mockResolvedValue({ result: null, reason: "out-of-boundary" }),
	createUploadUrl: vi.fn().mockResolvedValue({ result: null, reason: "out-of-boundary" }),
	completeUpload: vi.fn().mockResolvedValue({ result: null, reason: "out-of-boundary" }),
	removeGrant: vi.fn().mockResolvedValue({ result: null, reason: "out-of-boundary" }),
	updateGrantRole: vi.fn().mockResolvedValue({ result: null, reason: "out-of-boundary" }),
}

const ctx = (scopes: string[], folderAccess: "all" | "named" = "all") => ({
	principal: { kind: "connection" as const, id: "c1", folderAccess },
	scopes: scopes as never,
	usecase: usecase as never,
})

describe("dispatchTool", () => {
	it("has a handler for every registered tool", () => {
		expect(Object.keys(TOOL_TABLE).sort()).toEqual([...TOOL_NAMES].sort())
	})

	it("refuses a tool whose scope was not granted, naming the scope", async () => {
		const result = await dispatchTool(ctx(["read"]), "artifact_upload", {})
		expect(result.isError).toBe(true)
		expect(result.content[0]!.text).toContain("requires the write scope")
		expect(usecase.upload).not.toHaveBeenCalled()
	})

	it("refuses a name that is not on the map at all", async () => {
		const result = await dispatchTool(ctx(["read", "write", "manage"]), "artifact_delete", {})
		expect(result.isError).toBe(true)
		expect(result.content[0]!.text).toContain("artifact_delete")
	})

	it("turns an input-schema failure into a tool error, not a transport error", async () => {
		const result = await dispatchTool(ctx(["read"]), "artifact_read", { artifact_id: "not-a-uuid" })
		expect(result.isError).toBe(true)
		expect(result.content[0]!.text).toContain("artifact_read")
	})

	it("logs a thrown error and tells the model nothing about it", async () => {
		const log = vi.fn<(event: { tool: string; error: unknown }) => void>()
		usecase.listProjects.mockRejectedValueOnce(new Error('relation "exagram.projects" does not exist'))
		const result = await dispatchTool({ ...ctx(["read"]), log }, "project_list", {})
		expect(result.isError).toBe(true)
		expect(result.content[0]!.text).not.toContain("relation")
		expect(result.content[0]!.text).not.toContain("schema")
		expect(log).toHaveBeenCalledWith({ tool: "project_list", error: expect.any(Error) as Error })
	})

	it("runs a tool whose scope is granted", async () => {
		const result = await dispatchTool(ctx(["read"]), "project_list", {})
		expect(result.isError).toBeUndefined()
		expect(usecase.listProjects).toHaveBeenCalled()
	})

	it("returns an explicit refusal when an image read is not text-readable", async () => {
		usecase.readArtifact.mockRejectedValueOnce(new BinaryImageReadError())
		const result = await dispatchTool(ctx(["read"]), "artifact_read", {
			artifact_id: "11111111-1111-4111-8111-111111111111",
		})
		expect(result.isError).toBe(true)
		expect(result.content[0]!.text).toBe("This is a binary image and is not readable as text.")
	})

	it("uses the same named-folder refusal for a binary image read", async () => {
		usecase.readArtifact.mockRejectedValueOnce(new BinaryImageReadError())
		const result = await dispatchTool(ctx(["read"], "named"), "artifact_read", {
			artifact_id: "11111111-1111-4111-8111-111111111111",
		})
		expect(result.content[0]!.text).toBe(NARROWED_REFUSAL_TEXT)
	})

	it("delivers marker-only parsed text through artifact_read", async () => {
		usecase.readArtifact.mockResolvedValueOnce({
			artifact: {
				artifactId: "11111111-1111-4111-8111-111111111111",
				revisionId: "22222222-2222-4222-8222-222222222222",
				title: "Empty spreadsheet export",
				kind: "xlsx",
				seq: 1,
				status: "approved",
				body: "<!-- Sheet: Sheet1 -->",
			},
			reason: null,
		})
		const result = await dispatchTool(ctx(["read"]), "artifact_read", {
			artifact_id: "11111111-1111-4111-8111-111111111111",
		})
		expect(result.isError).toBeUndefined()
		expect(result.content[0]!.text).toContain("<!-- Sheet: Sheet1 -->")
	})
})
