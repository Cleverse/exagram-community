import { describe, expect, it } from "vitest"

import { approvalsContract } from "./contract"
import { PendingRevisionSchema } from "./types"

describe("approvals contract", () => {
	it("exposes exactly listPending, approve and discard", () => {
		expect(Object.keys(approvalsContract).sort()).toEqual(["approve", "discard", "listPending"])
	})

	it("carries the artifact title and kind on a pending row", () => {
		const parsed = PendingRevisionSchema.parse({
			revisionId: "11111111-1111-4111-8111-111111111111",
			artifactId: "22222222-2222-4222-8222-222222222222",
			seq: 1,
			authorUserId: "33333333-3333-4333-8333-333333333333",
			authorConnectionId: null,
			mime: "text/markdown",
			bytes: 3,
			note: null,
			createdAt: new Date(),
			title: "Note",
			kind: "doc",
			ownerId: "33333333-3333-4333-8333-333333333333",
			isApprover: true,
			placeholderTypes: ["EMAIL"],
			redactionStatus: "done",
			authorName: "Ada",
			authorConnectionName: null,
		})
		expect(parsed.title).toBe("Note")
	})

	it("carries who wrote a pending row: the person, and the Connection when one wrote it", () => {
		const row = {
			revisionId: "11111111-1111-4111-8111-111111111111",
			artifactId: "22222222-2222-4222-8222-222222222222",
			seq: 2,
			authorUserId: "33333333-3333-4333-8333-333333333333",
			authorConnectionId: "44444444-4444-4444-8444-444444444444",
			mime: "text/markdown",
			bytes: 3,
			note: null,
			createdAt: new Date(),
			title: "Note",
			kind: "doc",
			ownerId: "33333333-3333-4333-8333-333333333333",
			isApprover: true,
			placeholderTypes: [],
			redactionStatus: "done",
			authorName: "Ada",
			authorConnectionName: "Claude Code",
		}
		expect(PendingRevisionSchema.parse(row)).toMatchObject({ authorName: "Ada", authorConnectionName: "Claude Code" })
		expect(() => PendingRevisionSchema.parse({ ...row, authorName: undefined })).toThrow()
	})

	it("says whether the caller approves the row, so no client re-derives it from ownerId", () => {
		const row = {
			revisionId: "11111111-1111-4111-8111-111111111111",
			artifactId: "22222222-2222-4222-8222-222222222222",
			seq: 2,
			authorUserId: "33333333-3333-4333-8333-333333333333",
			authorConnectionId: null,
			mime: "text/markdown",
			bytes: 3,
			note: null,
			createdAt: new Date(),
			title: "Note",
			kind: "doc",
			ownerId: "33333333-3333-4333-8333-333333333333",
			isApprover: false,
			placeholderTypes: [],
			redactionStatus: "done",
			authorName: "Ada",
			authorConnectionName: null,
		}
		expect(PendingRevisionSchema.parse(row).isApprover).toBe(false)
		expect(() => PendingRevisionSchema.parse({ ...row, isApprover: undefined })).toThrow()
	})
})
