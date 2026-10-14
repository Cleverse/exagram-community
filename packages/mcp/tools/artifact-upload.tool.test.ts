import { REDACTION_LIMIT_BYTES } from "@exagram/core/entity/redaction"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { TOOL_INPUTS } from "../registry"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"

import { artifactUpload } from "./artifact-upload.tool"

const project = "11111111-1111-4111-8111-111111111111"
const artifact = "22222222-2222-4222-8222-222222222222"

const ctx = (upload: unknown, folderAccess: "all" | "named" = "all") => ({
	principal: { kind: "connection" as const, id: "c1", folderAccess },
	scopes: ["read", "write"] as const,
	usecase: { upload } as never,
})

describe("artifact_upload", () => {
	it('says the Revision is Pending and readable back with revision "latest"', async () => {
		const upload = vi.fn().mockResolvedValue({
			result: { artifactId: artifact, revisionId: "r1", seq: 1, status: "pending" },
			reason: "out-of-boundary",
		})
		const result = await artifactUpload(ctx(upload), {
			project_id: project,
			kind: "doc",
			title: "Notes",
			content: "hello",
		})
		expect(upload).toHaveBeenCalledWith(
			{ kind: "connection", id: "c1", folderAccess: "all" },
			{ projectId: project, kind: "doc", title: "Notes", content: "hello" },
		)
		const out = result.content[0]!.text
		expect(out).toContain(artifact)
		expect(out).toContain("Pending")
		expect(out).toContain('revision "latest"')
	})

	it("says the Revision is already Current when it published on arrival", async () => {
		const upload = vi.fn().mockResolvedValue({
			result: { artifactId: artifact, revisionId: "r1", seq: 1, status: "approved" },
			reason: null,
		})
		const result = await artifactUpload(ctx(upload), {
			project_id: project,
			kind: "doc",
			title: "Notes",
			content: "hello",
		})
		const out = result.content[0]!.text
		expect(out).toContain("published")
		expect(out).toContain("Current Revision")
		expect(out).not.toContain("Pending")
	})

	it("links the Artifact's page under the web origin", async () => {
		const upload = vi
			.fn()
			.mockResolvedValue({ result: { artifactId: artifact, revisionId: "r1", seq: 1, status: "pending" } })
		const result = await artifactUpload(
			{ ...ctx(upload), webOrigin: "https://app.exagram.test" },
			{ project_id: project, kind: "doc", title: "Notes", content: "hello" },
		)
		expect(result.content[0]!.text).toContain(`https://app.exagram.test/artifacts/${artifact}`)
	})

	it("refuses a project outside the connection with the one not-found sentence", async () => {
		const result = await artifactUpload(ctx(vi.fn().mockResolvedValue({ result: null, reason: "out-of-boundary" })), {
			project_id: project,
			kind: "doc",
			title: "Notes",
			content: "hello",
		})
		expect(result.content[0]!.text).toContain(REFUSAL_TEXT)
		expect(result.content[0]!.text).toContain("NOTHING was written.")
		expect(result.isError).toBe(true)
	})

	it("refuses a revision whose kind does not match the target artifact, same sentence as any other refusal", async () => {
		const upload = vi.fn().mockResolvedValue({ result: null, reason: "out-of-boundary" })
		const result = await artifactUpload(ctx(upload), {
			project_id: project,
			kind: "doc",
			title: "Notes",
			content: "hello",
			artifact_id: artifact,
		})
		expect(upload).toHaveBeenCalledWith(
			{ kind: "connection", id: "c1", folderAccess: "all" },
			{ projectId: project, kind: "doc", title: "Notes", content: "hello", artifactId: artifact },
		)
		expect(result.content[0]!.text).toContain(REFUSAL_TEXT)
		expect(result.isError).toBe(true)
	})

	it("uses one named-folder refusal for every upload failure", async () => {
		for (const reason of ["outside-connection-folders", "out-of-boundary", "redaction-unavailable"]) {
			const upload = vi.fn().mockResolvedValue({ result: null, reason })
			const result = await artifactUpload(ctx(upload, "named"), {
				project_id: project,
				kind: "doc",
				title: "Notes",
				content: "hello",
			})
			expect(result.content[0]!.text).toBe(`${NARROWED_REFUSAL_TEXT} NOTHING was written.`)
		}
	})

	it("refuses a kind an AI client may not create", async () => {
		await expect(
			artifactUpload(ctx(vi.fn()), { project_id: project, kind: "pdf", title: "x", content: "y" }),
		).rejects.toThrow()
	})

	it("rejects content over the upload limit as a validation error", async () => {
		await expect(
			artifactUpload(ctx(vi.fn()), {
				project_id: project,
				kind: "doc",
				title: "x",
				content: "x".repeat(REDACTION_LIMIT_BYTES + 1),
			}),
		).rejects.toThrow()
		expect(
			z.object(TOOL_INPUTS.artifact_upload).safeParse({
				project_id: project,
				kind: "doc",
				title: "x",
				content: "x".repeat(REDACTION_LIMIT_BYTES + 1),
			}).error?.issues[0]?.message,
		).toBe("content exceeds the 5 MB upload limit")
	})
})
