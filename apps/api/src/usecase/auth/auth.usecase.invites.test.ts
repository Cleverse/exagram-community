import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { hashLinkToken, mintLinkToken } from "@exagram/core/services/link-token.service"
import { inlineTx } from "@exagram/core/test/tx"
import { AlreadyInTeamError, ConflictError, JoinPendingError } from "@exagram/core/utils/errors"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway, StartCallParams } from "@exagram/core/datagateway/ledger.datagateway"
import type { InviteVia } from "@exagram/core/entity/invite"

import { FakeAuthDatagateway } from "./auth.datagateway.fake"
import {
	AuthUsecase,
	InviteEmailMismatchError,
	InviteInvalidError,
	SignUpInviteOnlyError,
	type AuthUsecaseOptions,
	type SignUpMode,
} from "./auth.usecase"
import { fakeJoins } from "./join-requests.datagateway.fake"

const buildLedger = () => {
	const calls: StartCallParams[] = []
	const gateway = {
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
	return { gateway, calls }
}

const build = (signUpMode: SignUpMode = "open", options: AuthUsecaseOptions = {}) => {
	const gateway = new FakeAuthDatagateway()
	const joins = fakeJoins()
	const ledger = buildLedger()
	const usecase = new AuthUsecase(gateway, new PasswordService(), new SessionTokenService(), inlineTx(), joins, 3600, {
		...options,
		signUpMode,
		ledger: new LedgerService(ledger.gateway),
	})
	return { gateway, joins, usecase, ledgerCalls: ledger.calls }
}

const PASSWORD = "correct horse battery"
const SIGN_UP_REFUSAL = "Sign-up on this install is by invitation. Ask your Admin for an invite link."
const googleProfile = { sub: "google-subject", email: "invited@acme.test", name: "Invited Person" }

/** Returns the Join Link's token; `admin.user` acts in the Team. */
const withInvite = async (
	built: ReturnType<typeof build>,
	invite: { email?: string; role?: "admin" | "member"; via?: InviteVia; expiresAt?: Date } = {},
) => {
	const signedUp = await built.usecase.signUp({ email: "admin@acme.test", name: "Admin", password: PASSWORD })
	const team = await built.gateway.createWorkspace("Acme")
	await built.gateway.joinWorkspace({ userId: signedUp.user.id, workspaceId: team.id, role: "admin" })
	const admin = { ...signedUp, user: { ...signedUp.user, workspaceId: team.id } }
	const { token, tokenHash } = mintLinkToken()
	built.gateway.seedInvite({
		workspaceId: admin.user.workspaceId,
		email: invite.email ?? "invited@acme.test",
		role: invite.role ?? "member",
		via: invite.via ?? "admin_invite",
		tokenHash,
		invitedBy: admin.user.id,
		...(invite.expiresAt ? { expiresAt: invite.expiresAt } : {}),
	})
	return { admin, token }
}

/** The row sharing with an outside email leaves: invited, no password, claimable by Google. */
const seedInvitedMember = async (gateway: FakeAuthDatagateway, workspaceId: string, email: string) => {
	await gateway.createUser({
		workspaceId,
		email,
		name: email,
		passwordHash: GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
		isAdmin: false,
	})
	const row = gateway.users.find((user) => user.email === email)!
	row.unclaimed = true
	return row
}

describe("AuthUsecase sign-up mode invite", () => {
	it("lets the first account sign up as Admin, then refuses every uninvited password sign-up", async () => {
		const { gateway, usecase } = build("invite")
		expect(await usecase.signUpOpen()).toBe(true)
		const first = await usecase.signUp({ email: "first@acme.test", name: "First", password: PASSWORD })
		expect(first.user.isAdmin).toBe(true)
		expect(gateway.lockCount).toBe(1)
		expect(await usecase.signUpOpen()).toBe(false)

		await expect(usecase.signUp({ email: "b@acme.test", name: "B", password: PASSWORD })).rejects.toThrow(
			SIGN_UP_REFUSAL,
		)
		expect(gateway.users).toHaveLength(1)
	})

	it("lets the first Google account in, then refuses a Google sign-up with no Invite and no invited row", async () => {
		const { gateway, usecase } = build("invite")
		const first = await usecase.signInWithGoogle({
			profile: { ...googleProfile, sub: "first-subject", email: "first@acme.test" },
		})
		expect(first.user.isAdmin).toBe(true)

		await expect(usecase.signInWithGoogle({ profile: googleProfile })).rejects.toBeInstanceOf(SignUpInviteOnlyError)
		await expect(usecase.signInWithGoogle({ profile: googleProfile, choice: "create" })).rejects.toBeInstanceOf(
			SignUpInviteOnlyError,
		)
		expect(gateway.users).toHaveLength(1)

		// An existing account still signs in.
		const again = await usecase.signInWithGoogle({
			profile: { ...googleProfile, sub: "first-subject", email: "first@acme.test" },
		})
		expect(again.user.id).toBe(first.user.id)
	})

	it("still lets an invited Member claim their row with Google", async () => {
		const { gateway, usecase } = build("invite")
		await usecase.signUp({ email: "first@acme.test", name: "First", password: PASSWORD })
		const team = await gateway.createWorkspace("Acme")
		const row = await seedInvitedMember(gateway, team.id, googleProfile.email)
		const claimed = await usecase.signInWithGoogle({ profile: googleProfile })
		expect(claimed.user.id).toBe(row.id)
	})

	it("accepts a Join Link after the first account", async () => {
		const built = build("invite")
		const { admin, token } = await withInvite(built)
		const joined = await built.usecase.signUp({
			email: "Invited@acme.test",
			name: "Invited",
			password: PASSWORD,
			inviteToken: token,
		})
		expect(joined.user.workspaceId).toBe(admin.user.workspaceId)
	})

	it("keeps sign-up open in open mode", async () => {
		const { usecase } = build("open")
		await usecase.signUp({ email: "first@acme.test", name: "First", password: PASSWORD })
		expect(await usecase.signUpOpen()).toBe(true)
	})
})

describe("AuthUsecase accepting an Invite", () => {
	it("joins the Invite's Workspace with its role, deletes the Invite and ledgers the accept", async () => {
		const built = build()
		const { admin, token } = await withInvite(built, { role: "admin" })
		const joined = await built.usecase.signUp({
			email: "invited@acme.test",
			name: "Invited",
			password: PASSWORD,
			inviteToken: token,
		})
		expect(joined.user).toMatchObject({ workspaceId: admin.user.workspaceId, isAdmin: true })
		expect(built.gateway.invites).toHaveLength(0)
		expect(built.ledgerCalls).toEqual([
			{
				principalKind: "user",
				principalId: joined.user.id,
				surface: "web",
				action: "workspace.invite.accept",
				subject: "invited@acme.test",
				workspaceId: admin.user.workspaceId,
			},
		])
	})

	it("refuses a typed email that is not the Invite's", async () => {
		const built = build()
		const { token } = await withInvite(built)
		await expect(
			built.usecase.signUp({ email: "someone@acme.test", name: "S", password: PASSWORD, inviteToken: token }),
		).rejects.toBeInstanceOf(InviteEmailMismatchError)
		expect(built.gateway.users).toHaveLength(1)
	})

	it("answers an unknown, used and expired token the same way", async () => {
		const built = build()
		const { admin, token } = await withInvite(built)
		const expired = mintLinkToken()
		built.gateway.seedInvite({
			workspaceId: admin.user.workspaceId,
			email: "late@acme.test",
			tokenHash: expired.tokenHash,
			invitedBy: admin.user.id,
			expiresAt: new Date(Date.now() - 1000),
		})
		await built.usecase.signUp({ email: "invited@acme.test", name: "I", password: PASSWORD, inviteToken: token })

		for (const [email, inviteToken] of [
			["invited2@acme.test", token],
			["late@acme.test", expired.token],
			["x@acme.test", mintLinkToken().token],
		] as const) {
			await expect(built.usecase.signUp({ email, name: "N", password: PASSWORD, inviteToken })).rejects.toBeInstanceOf(
				InviteInvalidError,
			)
		}
	})

	it("claims the invited Member's row in the Invite's Workspace with a password and the Join Link", async () => {
		const built = build()
		const { admin, token } = await withInvite(built, { role: "admin" })
		const row = await seedInvitedMember(built.gateway, admin.user.workspaceId, "invited@acme.test")

		const claimed = await built.usecase.signUp({
			email: "invited@acme.test",
			name: "Invited Person",
			password: PASSWORD,
			inviteToken: token,
		})

		expect(claimed.user).toMatchObject({ id: row.id, workspaceId: admin.user.workspaceId, isAdmin: true })
		expect(row.unclaimed).toBe(false)
		expect(row.name).toBe("Invited Person")
		expect(built.gateway.invites).toHaveLength(0)
		const signedIn = await built.usecase.signIn({ email: "invited@acme.test", password: PASSWORD })
		expect(signedIn.user.id).toBe(row.id)
	})

	it.each([
		{ install: "Community without Google", emailProof: false, inviteByEmail: true, sleeps: true },
		{ install: "one that proves emails", emailProof: true, inviteByEmail: true, sleeps: true },
		{ install: "one where shares make no row", emailProof: false, inviteByEmail: false, sleeps: false },
	])(
		"on $install, a password claim through another Team's Join Link puts unvouched Grants to sleep: $sleeps",
		async ({ emailProof, inviteByEmail, sleeps }) => {
			const built = build("open", { emailProof, inviteByEmail })
			const { token } = await withInvite(built)
			const elsewhere = await built.gateway.createWorkspace("Elsewhere")
			const row = await seedInvitedMember(built.gateway, elsewhere.id, "invited@acme.test")

			const claimed = await built.usecase.signUp({
				email: "invited@acme.test",
				name: "Invited Person",
				password: PASSWORD,
				inviteToken: token,
			})

			expect(claimed.user.id).toBe(row.id)
			expect(built.gateway.sleptFor).toEqual(sleeps ? [row.id] : [])
			// The session minted after the join wakes what the Team vouches for.
			expect(built.gateway.wokenFor).toContain(row.id)
		},
	)

	it("claims an invited Member's row with a password and no Join Link into a Personal Workspace, not the Team", async () => {
		const built = build()
		const { admin } = await withInvite(built)
		const row = await seedInvitedMember(built.gateway, admin.user.workspaceId, "invited@acme.test")
		const signedUp = await built.usecase.signUp({ email: "invited@acme.test", name: "Invited", password: PASSWORD })
		expect(signedUp.user.id).toBe(row.id)
		expect(signedUp.user.workspaceId).not.toBe(admin.user.workspaceId)
		expect(await built.gateway.getWorkspaceById(signedUp.user.workspaceId)).toMatchObject({ kind: "personal" })
	})

	it("joins through a pending Invite on a verified Google sign-up with no token", async () => {
		const built = build()
		const { admin } = await withInvite(built, { email: googleProfile.email, role: "admin" })
		const joined = await built.usecase.signInWithGoogle({ profile: googleProfile })
		expect(joined.user).toMatchObject({ workspaceId: admin.user.workspaceId, isAdmin: true })
		expect(built.gateway.invites).toHaveLength(0)
		expect(built.ledgerCalls.map((call) => call.action)).toEqual(["workspace.invite.accept"])
	})

	it("claims an invited Member's row with Google into a Personal Workspace and leaves an Invite elsewhere alone", async () => {
		const built = build()
		const { admin } = await withInvite(built, { email: googleProfile.email })
		const other = await built.gateway.createWorkspace("Elsewhere")
		const row = await seedInvitedMember(built.gateway, other.id, googleProfile.email)

		const claimed = await built.usecase.signInWithGoogle({ profile: googleProfile })

		expect(claimed.user).toMatchObject({ id: row.id })
		expect(claimed.user.workspaceId).not.toBe(other.id)
		expect(await built.gateway.getWorkspaceById(claimed.user.workspaceId)).toMatchObject({ kind: "personal" })
		expect(built.gateway.invites).toHaveLength(1)
		expect(built.gateway.invites[0]!.workspaceId).toBe(admin.user.workspaceId)
	})

	it("refuses a Google account whose verified email is not the Join Link's", async () => {
		const built = build()
		const { token } = await withInvite(built)
		await expect(
			built.usecase.signInWithGoogle({ profile: { ...googleProfile, email: "else@acme.test" }, inviteToken: token }),
		).rejects.toBeInstanceOf(InviteEmailMismatchError)
	})

	it("previews a live Join Link and refuses a dead one", async () => {
		const built = build()
		const { token } = await withInvite(built)
		expect(await built.usecase.previewInvite(token)).toEqual({
			email: "invited@acme.test",
			role: "member",
			workspaceName: "Acme",
		})
		expect(built.gateway.invites).toHaveLength(1)
		await expect(built.usecase.previewInvite(hashLinkToken(token))).rejects.toBeInstanceOf(InviteInvalidError)
	})
})

describe("AuthUsecase an existing account accepting a Member's Invite that waits for an Admin", () => {
	const email = googleProfile.email

	it("opens a Join Request bound to the account's password hash, and makes no second account", async () => {
		const built = build()
		const { token } = await withInvite(built, { via: "member_invite" })
		await built.usecase.signUp({ email, name: "Invited", password: PASSWORD })
		const account = built.gateway.users.find((user) => user.email === email)!

		await expect(
			built.usecase.signUp({ email, name: "Invited", password: PASSWORD, inviteToken: token }),
		).rejects.toBeInstanceOf(JoinPendingError)

		expect(built.joins.requests.rows).toMatchObject([
			{ email, via: "member_invite", passwordHash: account.passwordHash, googleSubject: null },
		])
		expect(built.gateway.users.filter((user) => user.email === email)).toHaveLength(1)
		expect(account.liveTeamId).toBeNull()
	})

	it("refuses a wrong password as already registered and opens no request", async () => {
		const built = build()
		const { token } = await withInvite(built, { via: "member_invite" })
		await built.usecase.signUp({ email, name: "Invited", password: PASSWORD })

		await expect(
			built.usecase.signUp({ email, name: "Invited", password: "not the password", inviteToken: token }),
		).rejects.toBeInstanceOf(ConflictError)

		expect(built.joins.requests.rows).toEqual([])
	})

	it("refuses an account already in a Team with ALREADY_IN_TEAM and opens no request", async () => {
		const built = build()
		const { token } = await withInvite(built, { via: "member_invite" })
		const signedUp = await built.usecase.signUp({ email, name: "Invited", password: PASSWORD })
		const elsewhere = await built.gateway.createWorkspace("Elsewhere")
		await built.gateway.joinWorkspace({ userId: signedUp.user.id, workspaceId: elsewhere.id, role: "member" })

		await expect(
			built.usecase.signUp({ email, name: "Invited", password: PASSWORD, inviteToken: token }),
		).rejects.toBeInstanceOf(AlreadyInTeamError)

		expect(built.joins.requests.rows).toEqual([])
	})

	it("opens a Join Request bound to the Google identity for a known Google account", async () => {
		const built = build()
		await built.usecase.signInWithGoogle({ profile: googleProfile })
		const { token } = await withInvite(built, { via: "member_invite" })

		await expect(built.usecase.signInWithGoogle({ profile: googleProfile, inviteToken: token })).rejects.toBeInstanceOf(
			JoinPendingError,
		)

		expect(built.joins.requests.rows).toMatchObject([
			{ email, via: "member_invite", passwordHash: null, googleSubject: googleProfile.sub },
		])
		expect(built.gateway.users.filter((user) => user.email === email)).toHaveLength(1)
	})
})
