import { PlaceholdersNeedConfirmationError, RedactionNotReadyError } from "@exagram/core/utils/errors"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { ApprovalsDatagateway, PendingRevisionDetail } from "@exagram/core/datagateway/approvals.datagateway"
import type { User } from "@exagram/core/entity/auth"

import { ApprovalsUsecase } from "./approvals.usecase"

const owner: User = {
	id: "u1",
	workspaceId: "w1",
	email: "a@acme.test",
	name: "A",
	isAdmin: true,
	googleLinked: false,
	createdAt: new Date(),
}

const pending: PendingRevisionDetail = {
	revisionId: "rev-1",
	artifactId: "art-1",
	seq: 1,
	authorUserId: "u1",
	authorConnectionId: null,
	mime: "text/markdown",
	bytes: 3,
	note: null,
	createdAt: new Date(),
	title: "Note",
	kind: "doc",
	ownerId: "u1",
	isApprover: true,
	placeholderTypes: [],
	redactionStatus: "done",
	authorName: "Owner",
	authorConnectionName: null,
}

const build = (overrides: Partial<ApprovalsDatagateway> = {}) => {
	const approve = vi.fn<ApprovalsDatagateway["approve"]>().mockResolvedValue("rev-1")
	const gateway: ApprovalsDatagateway = {
		listPending: () => Promise.resolve([pending]),
		approve,
		discard: () => Promise.resolve("rev-1"),
		...overrides,
	}
	return { approve, gateway, usecase: new ApprovalsUsecase(gateway) }
}

describe("ApprovalsUsecase", () => {
	it("lists the caller's pending queue", async () => {
		await expect(build().usecase.listPending(owner)).resolves.toEqual([pending])
	})

	it("returns the approved revision id", async () => {
		await expect(build().usecase.approve(owner, { revisionId: "rev-1", confirmPlaceholders: false })).resolves.toEqual({
			revisionId: "rev-1",
		})
	})

	it("refuses an approve the database declined, with the uniform sentence", async () => {
		await expect(
			build({ approve: () => Promise.resolve(null) }).usecase.approve(owner, {
				revisionId: "rev-1",
				confirmPlaceholders: false,
			}),
		).rejects.toThrow(REFUSAL_TEXT)
	})

	it("refuses a discard the database declined, with the uniform sentence", async () => {
		await expect(build({ discard: () => Promise.resolve(null) }).usecase.discard(owner, "rev-1")).rejects.toThrow(
			REFUSAL_TEXT,
		)
	})

	it("passes the confirmation through to approve_revision", async () => {
		const { usecase, approve } = build()
		await usecase.approve(owner, { revisionId: "rev-1", confirmPlaceholders: true })
		expect(approve).toHaveBeenCalledWith("rev-1", owner.id, true)
	})

	it("turns the guard's refusal into a typed reason naming what to confirm", async () => {
		const approve = vi
			.fn<ApprovalsDatagateway["approve"]>()
			.mockRejectedValue(
				new PlaceholdersNeedConfirmationError(
					"This Revision was written by a Connection and contains placeholders. Approve it again to confirm that the placeholders will become the content in place of the real values.",
				),
			)
		const { usecase } = build({ approve })
		const result = usecase.approve(owner, { revisionId: "rev-1", confirmPlaceholders: false })
		await expect(result).rejects.toThrow(/confirm that the placeholders will become the content/i)
		await expect(result).rejects.toMatchObject({ code: "PLACEHOLDERS_NEED_CONFIRMATION", statusCode: 400 })
	})

	it("turns the not-yet-redacted refusal into its own typed reason", async () => {
		const approve = vi
			.fn<ApprovalsDatagateway["approve"]>()
			.mockRejectedValue(
				new RedactionNotReadyError("This Revision has not been checked for sensitive values yet. Try again shortly."),
			)
		const { usecase } = build({ approve })
		const result = usecase.approve(owner, { revisionId: "rev-1", confirmPlaceholders: true })
		await expect(result).rejects.toThrow(/not been checked for sensitive values yet/i)
		await expect(result).rejects.toMatchObject({ code: "REDACTION_NOT_READY", statusCode: 400 })
	})
})
