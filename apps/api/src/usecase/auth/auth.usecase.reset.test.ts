import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { inlineTx } from "@exagram/core/test/tx"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway, StartCallParams } from "@exagram/core/datagateway/ledger.datagateway"

import { FakeAuthDatagateway } from "./auth.datagateway.fake"
import { AuthUsecase, RESET_LINK_USE_ACTION, ResetLinkInvalidError } from "./auth.usecase"
import { fakeJoins } from "./join-requests.datagateway.fake"

const PASSWORD = "correct horse battery"
const NEW_PASSWORD = "a brand new passphrase"

const build = async (adminPasswordReset = true) => {
	const gateway = new FakeAuthDatagateway()
	const joins = fakeJoins()
	const calls: StartCallParams[] = []
	const ledgerGateway = {
		startCall: vi.fn().mockImplementation((params: StartCallParams) => {
			calls.push(params)
			return Promise.resolve(`call-${calls.length}`)
		}),
		recordServe: vi.fn().mockResolvedValue(undefined),
		markDelivered: vi.fn().mockResolvedValue(undefined),
		markFailed: vi.fn().mockResolvedValue(undefined),
		setBodyDigest: vi.fn().mockResolvedValue(undefined),
		listForArtifact: vi.fn().mockResolvedValue([]),
		listActivity: vi.fn().mockResolvedValue([]),
		listArtifactViewers: vi.fn().mockResolvedValue([]),
	} satisfies LedgerDatagateway
	const usecase = new AuthUsecase(gateway, new PasswordService(), new SessionTokenService(), inlineTx(), joins, 3600, {
		ledger: new LedgerService(ledgerGateway),
		adminPasswordReset,
	})
	const signedUp = await usecase.signUp({ email: "member@acme.test", name: "Mo", password: PASSWORD })
	const team = await gateway.createWorkspace("Acme")
	await gateway.joinWorkspace({ userId: signedUp.user.id, workspaceId: team.id, role: "admin" })
	const member = { ...signedUp, user: { ...signedUp.user, workspaceId: team.id } }
	return { gateway, usecase, member, calls, ledgerGateway }
}

/** A Reset Link made by the server operator, unless `createdBy` names the Admin who made it in their home Workspace. */
const seedReset = (
	gateway: FakeAuthDatagateway,
	userId: string,
	expiresAt = new Date(Date.now() + 3_600_000),
	createdBy: string | null = null,
) => {
	const { token, tokenHash } = mintLinkToken()
	const workspaceId = gateway.users.find((user) => user.id === createdBy)?.workspaceId ?? null
	gateway.resets.push({ userId, tokenHash, createdBy, workspaceId, expiresAt })
	return token
}

const IN_AN_HOUR = () => new Date(Date.now() + 3_600_000)

describe("AuthUsecase Reset Links", () => {
	it("previews a live Reset Link with its email and Workspace, and every dead one the same way", async () => {
		const { gateway, usecase, member } = await build()
		const live = seedReset(gateway, member.user.id)
		const expired = seedReset(gateway, member.user.id, new Date(Date.now() - 1000))

		await expect(usecase.previewResetLink(live)).resolves.toEqual({ email: "member@acme.test", workspaceName: "Acme" })
		await expect(usecase.previewResetLink(expired)).rejects.toEqual(new ResetLinkInvalidError())
		await expect(usecase.previewResetLink("unknown")).rejects.toEqual(new ResetLinkInvalidError())
	})

	it("sets the new password, ends every session, signs in afresh, and ledgers the use as the member", async () => {
		const { gateway, usecase, member, calls } = await build()
		await usecase.signIn({ email: "member@acme.test", password: PASSWORD })
		expect(gateway.sessions).toHaveLength(2)
		const token = seedReset(gateway, member.user.id)

		const signedIn = await usecase.resetPassword({ token, password: NEW_PASSWORD })

		expect(signedIn.user.id).toBe(member.user.id)
		expect(gateway.sessions).toHaveLength(1)
		expect(gateway.sessions[0]?.userId).toBe(member.user.id)
		await expect(usecase.resolveSession(member.token)).resolves.toBeNull()
		await expect(usecase.resolveSession(signedIn.token)).resolves.toMatchObject({ id: member.user.id })
		await expect(usecase.signIn({ email: "member@acme.test", password: PASSWORD })).rejects.toThrow()
		await expect(usecase.signIn({ email: "member@acme.test", password: NEW_PASSWORD })).resolves.toBeDefined()
		expect(gateway.resets).toEqual([])
		expect(calls).toContainEqual({
			principalKind: "user",
			principalId: member.user.id,
			surface: "web",
			action: RESET_LINK_USE_ACTION,
			subject: "member@acme.test",
			workspaceId: member.user.workspaceId,
		})
	})

	it("works once: a second use, an expired link and an unknown one all get the same refusal", async () => {
		const { gateway, usecase, member } = await build()
		const token = seedReset(gateway, member.user.id)
		await usecase.resetPassword({ token, password: NEW_PASSWORD })

		await expect(usecase.resetPassword({ token, password: PASSWORD })).rejects.toEqual(new ResetLinkInvalidError())
		const expired = seedReset(gateway, member.user.id, new Date(Date.now() - 1000))
		await expect(usecase.resetPassword({ token: expired, password: PASSWORD })).rejects.toEqual(
			new ResetLinkInvalidError(),
		)
		await expect(usecase.resetPassword({ token: "unknown", password: PASSWORD })).rejects.toEqual(
			new ResetLinkInvalidError(),
		)
		await expect(usecase.signIn({ email: "member@acme.test", password: NEW_PASSWORD })).resolves.toBeDefined()
	})

	it("ledgers nothing for an unknown or expired token", async () => {
		const { gateway, usecase, member, calls } = await build()
		const before = calls.length
		const expired = seedReset(gateway, member.user.id, new Date(Date.now() - 1000))
		await expect(usecase.resetPassword({ token: expired, password: PASSWORD })).rejects.toBeInstanceOf(
			ResetLinkInvalidError,
		)
		await expect(usecase.resetPassword({ token: "unknown", password: PASSWORD })).rejects.toBeInstanceOf(
			ResetLinkInvalidError,
		)
		expect(calls).toHaveLength(before)
	})

	describe("checks the rules a link was made under again when it is used", () => {
		/** The Acme Admin from `build`, and a non-Admin Member of Acme with a password. */
		const withMember = async (adminPasswordReset = true) => {
			const built = await build(adminPasswordReset)
			const plain = await built.gateway.createUser({
				workspaceId: built.member.user.workspaceId,
				email: "plain@acme.test",
				name: "Plain",
				passwordHash: await new PasswordService().hash(PASSWORD),
				isAdmin: false,
			})
			return { ...built, admin: built.member.user, plain }
		}

		/** Refused like any dead link, and used up: nothing changed, and the link is gone. */
		const expectRefusedAndBurned = async (
			{ gateway, usecase, calls, ledgerGateway }: Awaited<ReturnType<typeof withMember>>,
			token: string,
			targetId: string,
		) => {
			const passwordsBefore = gateway.users.map((user) => user.passwordHash)
			await expect(usecase.resetPassword({ token, password: NEW_PASSWORD })).rejects.toEqual(
				new ResetLinkInvalidError(),
			)
			expect(gateway.resets).toEqual([])
			expect(gateway.users.map((user) => user.passwordHash)).toEqual(passwordsBefore)
			expect(calls.filter((call) => call.action === RESET_LINK_USE_ACTION)).toEqual([
				{
					principalKind: "user",
					principalId: targetId,
					surface: "web",
					action: RESET_LINK_USE_ACTION,
					subject: "plain@acme.test",
					workspaceId: null,
				},
			])
			expect(ledgerGateway.markFailed).toHaveBeenCalledTimes(1)
		}

		it("refuses an Admin-made link once ADMIN_PASSWORD_RESET is off", async () => {
			const fx = await withMember(false)
			await expectRefusedAndBurned(fx, seedReset(fx.gateway, fx.plain.id, IN_AN_HOUR(), fx.admin.id), fx.plain.id)
		})

		it("still honours the operator's link with ADMIN_PASSWORD_RESET off", async () => {
			const fx = await withMember(false)
			const token = seedReset(fx.gateway, fx.plain.id)
			await expect(fx.usecase.resetPassword({ token, password: NEW_PASSWORD })).resolves.toMatchObject({
				user: { id: fx.plain.id },
			})
		})

		it("refuses an Admin-made link whose target has since become an Admin", async () => {
			const fx = await withMember()
			const token = seedReset(fx.gateway, fx.plain.id, IN_AN_HOUR(), fx.admin.id)
			await fx.gateway.promoteToAdmin(fx.plain.id, fx.plain.workspaceId)
			await expectRefusedAndBurned(fx, token, fx.plain.id)
		})

		it("refuses an Admin-made link whose maker is no longer an Admin", async () => {
			const fx = await withMember()
			const token = seedReset(fx.gateway, fx.plain.id, IN_AN_HOUR(), fx.admin.id)
			fx.gateway.users.find((user) => user.id === fx.admin.id)!.isAdmin = false
			await expectRefusedAndBurned(fx, token, fx.plain.id)
		})

		it("refuses an Admin-made link whose maker was Removed", async () => {
			const fx = await withMember()
			const token = seedReset(fx.gateway, fx.plain.id, IN_AN_HOUR(), fx.admin.id)
			fx.gateway.users.find((user) => user.id === fx.admin.id)!.hasLiveMembership = false
			await expectRefusedAndBurned(fx, token, fx.plain.id)
		})

		it("honours an Admin-made link while its maker is an Admin of the Workspace it was made in", async () => {
			const fx = await withMember()
			const token = seedReset(fx.gateway, fx.plain.id, IN_AN_HOUR(), fx.admin.id)
			await expect(fx.usecase.resetPassword({ token, password: NEW_PASSWORD })).resolves.toMatchObject({
				user: { id: fx.plain.id },
			})
		})

		it("honours the operator's link for an Admin", async () => {
			const fx = await withMember()
			const token = seedReset(fx.gateway, fx.admin.id)
			await expect(fx.usecase.resetPassword({ token, password: NEW_PASSWORD })).resolves.toMatchObject({
				user: { id: fx.admin.id },
			})
		})

		for (const [state, change] of [
			["invited", (user: { unclaimed: boolean }) => void (user.unclaimed = true)],
			["Google-only", (user: { passwordHash: string | null }) => void (user.passwordHash = null)],
			[
				"seeded for a Google claim",
				(user: { passwordHash: string | null }) => void (user.passwordHash = GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL),
			],
		] as const) {
			for (const maker of ["an Admin", "the operator"] as const) {
				it(`refuses ${maker}'s link to an account that is now ${state}`, async () => {
					const fx = await withMember()
					const token = seedReset(fx.gateway, fx.plain.id, IN_AN_HOUR(), maker === "an Admin" ? fx.admin.id : null)
					change(fx.gateway.users.find((user) => user.id === fx.plain.id)!)
					await expectRefusedAndBurned(fx, token, fx.plain.id)
				})
			}
		}
	})
})
