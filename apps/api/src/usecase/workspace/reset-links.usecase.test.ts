import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { hashLinkToken } from "@exagram/core/services/link-token.service"
import { inlineTx } from "@exagram/core/test/tx"
import { RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway, StartCallParams } from "@exagram/core/datagateway/ledger.datagateway"
import type { PasswordResetsDatagateway } from "@exagram/core/datagateway/password-resets.datagateway"

import { runCli } from "../../cli"
import { FakeAuthDatagateway } from "../auth/auth.datagateway.fake"

import { RESET_LINK_CREATE_ACTION, ResetLinkNoAccountError, ResetLinksUsecase } from "./reset-links.usecase"

const NOW = new Date("2026-10-05T00:00:00Z")
const ONE_HOUR = new Date("2026-10-05T01:00:00Z")

/** Writes the Reset Links into the auth fake, as the one table backs both in Postgres. */
class FakePasswordResets implements PasswordResetsDatagateway {
	constructor(private readonly auth: FakeAuthDatagateway) {}

	upsert(input: { userId: string; tokenHash: string; createdBy: string | null; expiresAt: Date }) {
		const index = this.auth.resets.findIndex((reset) => reset.userId === input.userId)
		if (index >= 0) this.auth.resets.splice(index, 1)
		this.auth.resets.push(input)
		return Promise.resolve({ expiresAt: input.expiresAt })
	}
}

const build = async (enabled = true) => {
	const auth = new FakeAuthDatagateway()
	const workspace = await auth.createWorkspace("Acme")
	const other = await auth.createWorkspace("Other")
	const user = (workspaceId: string, email: string, isAdmin = false, passwordHash: string | null = "hash") =>
		auth.createUser({ workspaceId, email, name: email, passwordHash, isAdmin })
	const admin = await user(workspace.id, "admin@acme.test", true)
	const otherAdminHere = await user(workspace.id, "second@acme.test", true)
	const member = await user(workspace.id, "member@acme.test")
	const googleOnly = await user(workspace.id, "google@acme.test", false, null)
	const seeded = await user(workspace.id, "seeded@acme.test", false, GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL)
	const invited = await user(workspace.id, "invited@acme.test", false, GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL)
	auth.users.find((u) => u.id === invited.id)!.invitedAt = new Date()
	const outsider = await user(other.id, "outsider@other.test")
	const calls: StartCallParams[] = []
	const ledgerGateway = {
		startCall: vi.fn().mockImplementation((params: StartCallParams) => {
			calls.push(params)
			return Promise.resolve("call")
		}),
		recordServe: vi.fn().mockResolvedValue(undefined),
		markDelivered: vi.fn().mockResolvedValue(undefined),
		markFailed: vi.fn().mockResolvedValue(undefined),
		setBodyDigest: vi.fn().mockResolvedValue(undefined),
		listForArtifact: vi.fn().mockResolvedValue([]),
		listActivity: vi.fn().mockResolvedValue([]),
		listArtifactViewers: vi.fn().mockResolvedValue([]),
	} satisfies LedgerDatagateway
	const usecase = new ResetLinksUsecase(
		auth,
		new FakePasswordResets(auth),
		new LedgerService(ledgerGateway),
		inlineTx(),
		"https://app.example.test",
		enabled,
		() => NOW,
	)
	return {
		auth,
		workspace,
		other,
		admin,
		otherAdminHere,
		member,
		googleOnly,
		seeded,
		invited,
		outsider,
		calls,
		usecase,
	}
}

const tokenOf = (url: string) => url.split("/reset/")[1]!

describe("ResetLinksUsecase.createForMember", () => {
	it("makes a one-hour Reset Link for a Member, stores only its hash, and ledgers it with the email", async () => {
		const { usecase, auth, admin, member, calls } = await build()
		const issued = await usecase.createForMember(admin, " Member@Acme.test ")

		expect(issued.url).toMatch(/^https:\/\/app\.example\.test\/reset\/[A-Za-z0-9_-]{43}$/)
		expect(issued.expiresAt).toEqual(ONE_HOUR)
		expect(auth.resets).toEqual([
			{ userId: member.id, tokenHash: hashLinkToken(tokenOf(issued.url)), createdBy: admin.id, expiresAt: ONE_HOUR },
		])
		expect(calls).toEqual([
			{
				principalKind: "user",
				principalId: admin.id,
				workspaceId: admin.workspaceId,
				surface: "web",
				action: RESET_LINK_CREATE_ACTION,
				subject: "member@acme.test",
			},
		])
	})

	it("replaces an older Reset Link for the same person", async () => {
		const { usecase, auth, admin, member } = await build()
		const first = await usecase.createForMember(admin, member.email)
		const second = await usecase.createForMember(admin, member.email)

		expect(auth.resets).toHaveLength(1)
		expect(auth.resets[0]?.tokenHash).toBe(hashLinkToken(tokenOf(second.url)))
		expect(auth.resets[0]?.tokenHash).not.toBe(hashLinkToken(tokenOf(first.url)))
	})

	it("refuses another Admin, the Admin themselves, and a Google-only account the same way", async () => {
		const { usecase, auth, admin, otherAdminHere, googleOnly, calls } = await build()
		for (const email of [otherAdminHere.email, admin.email, googleOnly.email]) {
			const refusal = await usecase.createForMember(admin, email).catch((error: unknown) => error)
			expect(refusal).toEqual(new RefusalError())
		}
		expect(auth.resets).toEqual([])
		expect(calls).toEqual([])
	})

	it("acts in the Workspace the caller's session names, with the role they hold there", async () => {
		const { auth, admin, other, outsider, member, usecase, calls } = await build()
		auth.addMembership(admin.id, other.id)
		const asMemberOfOther = { id: admin.id, workspaceId: other.id }

		await expect(usecase.createForMember(asMemberOfOther, outsider.email)).rejects.toBeInstanceOf(RefusalError)
		expect(auth.resets).toEqual([])

		const asAdminOfOther = await auth.createUser({
			workspaceId: other.id,
			email: "boss@other.test",
			name: "Bo",
			passwordHash: "hash",
			isAdmin: true,
		})
		await expect(usecase.createForMember(asAdminOfOther, member.email)).rejects.toBeInstanceOf(RefusalError)
		await usecase.createForMember(asAdminOfOther, outsider.email)
		expect(auth.resets.map((reset) => reset.userId)).toEqual([outsider.id])
		expect(calls).toMatchObject([{ principalId: asAdminOfOther.id, workspaceId: other.id }])
	})

	it("refuses a Workspace the caller holds no live membership of exactly like a random one", async () => {
		const { auth, admin, other, member, usecase, calls } = await build()
		const refusal = (workspaceId: string) =>
			usecase.createForMember({ id: admin.id, workspaceId }, member.email).catch((error: unknown) => error)

		expect(await refusal(other.id)).toEqual(await refusal("9f1c2b3a-4d5e-4f60-8a7b-0c1d2e3f4a5b"))
		expect(await refusal(other.id)).toEqual(new RefusalError())
		expect(auth.resets).toEqual([])
		expect(calls).toEqual([])
	})

	it("refuses the same way for a flag that is off, a non-Admin, and anyone not a resettable Member here", async () => {
		const { usecase, auth, admin, member, seeded, invited, outsider, calls } = await build()
		const off = (await build(false)).usecase

		await expect(off.createForMember(admin, member.email)).rejects.toBeInstanceOf(RefusalError)
		await expect(usecase.createForMember(member, member.email)).rejects.toBeInstanceOf(RefusalError)
		for (const email of [outsider.email, "nobody@acme.test", invited.email, seeded.email]) {
			const refusal = await usecase.createForMember(admin, email).catch((error: unknown) => error)
			expect(refusal).toBeInstanceOf(RefusalError)
			expect(refusal).toEqual(new RefusalError())
		}
		expect(auth.resets).toEqual([])
		expect(calls).toEqual([])
	})
})

describe("ResetLinksUsecase.createByOperator", () => {
	it("makes a Reset Link for an account in any Workspace while the Admin flag is off, ledgered as the operator", async () => {
		const { usecase, auth, outsider, calls } = await build(false)
		const issued = await usecase.createByOperator("Outsider@Other.test")

		expect(issued.expiresAt).toEqual(ONE_HOUR)
		expect(auth.resets).toEqual([
			{ userId: outsider.id, tokenHash: hashLinkToken(tokenOf(issued.url)), createdBy: null, expiresAt: ONE_HOUR },
		])
		expect(calls).toEqual([
			{
				principalKind: "operator",
				principalId: outsider.id,
				workspaceId: null,
				surface: "operator",
				action: RESET_LINK_CREATE_ACTION,
				subject: "outsider@other.test",
			},
		])
	})

	it("makes one for an Admin, who recovers this way", async () => {
		const { usecase, admin } = await build()
		await expect(usecase.createByOperator(admin.email)).resolves.toMatchObject({ expiresAt: ONE_HOUR })
	})

	it("says when no account can get one, a Google-only account included", async () => {
		const { usecase, invited, googleOnly, seeded, calls } = await build()
		for (const email of ["nobody@acme.test", invited.email, googleOnly.email, seeded.email]) {
			await expect(usecase.createByOperator(email)).rejects.toBeInstanceOf(ResetLinkNoAccountError)
		}
		expect(calls).toEqual([])
	})

	it("refuses a Google-only account through the server command", async () => {
		const { usecase, auth, googleOnly } = await build()
		const deps = { createResetLink: (email: string) => usecase.createByOperator(email), log: vi.fn(), error: vi.fn() }

		await expect(runCli(["reset-link", googleOnly.email], deps)).resolves.toBe(1)
		expect(deps.error).toHaveBeenCalledWith("reset-link: No account with that email can get a reset link.")
		expect(deps.log).not.toHaveBeenCalled()
		expect(auth.resets).toEqual([])
	})
})
