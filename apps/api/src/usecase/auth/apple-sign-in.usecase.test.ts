import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { inlineTx } from "@exagram/core/test/tx"
import { JoinDeclinedError, JoinPendingError } from "@exagram/core/utils/errors"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway, StartCallParams } from "@exagram/core/datagateway/ledger.datagateway"
import type { AppleProfile } from "@exagram/core/services/auth/apple-oidc.service"

import { FakeAuthDatagateway } from "./auth.datagateway.fake"
import {
	AppleAuthConflictError,
	AppleEmailRequiredError,
	AuthUsecase,
	GoogleAuthConflictError,
	JoinOfferedError,
	SignUpInviteOnlyError,
	type SignUpMode,
} from "./auth.usecase"
import { fakeJoins } from "./join-requests.datagateway.fake"

const PASSWORD = "correct horse battery"
const RELAY = "x7k2abc9@privaterelay.appleid.com"

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

const build = ({ signUpMode = "open" }: { signUpMode?: SignUpMode } = {}) => {
	const gateway = new FakeAuthDatagateway()
	const joins = fakeJoins()
	const ledger = buildLedger()
	const usecase = new AuthUsecase(gateway, new PasswordService(), new SessionTokenService(), inlineTx(), joins, 3600, {
		signUpMode,
		ledger: new LedgerService(ledger.gateway),
	})
	return { gateway, joins, usecase, ledgerCalls: ledger.calls }
}

type Built = ReturnType<typeof build>

const apple = (overrides: Partial<AppleProfile> = {}): AppleProfile => ({
	sub: "001234.apple.0001",
	email: "person@acme.test",
	relay: false,
	...overrides,
})

const appleIdentitiesOf = (built: Built, userId: string) =>
	built.gateway.identities.filter((identity) => identity.userId === userId && identity.provider === "apple")

const acmeTeam = async (built: Built) => {
	const team = await built.gateway.createWorkspace("Acme")
	const admin = await built.gateway.createUser({
		workspaceId: team.id,
		email: "admin@acme.test",
		name: "Ada",
		passwordHash: null,
		isAdmin: true,
	})
	return { workspaceId: team.id, admin }
}

describe("AuthUsecase.signInWithApple", () => {
	it("creates an account at home in its own Personal Workspace, holding the Apple identity and its address proven", async () => {
		const built = build()
		const signedIn = await built.usecase.signInWithApple({ profile: apple(), name: "Pat Lee" })

		expect(signedIn.user).toMatchObject({ email: "person@acme.test", name: "Pat Lee", isAdmin: true })
		expect(built.gateway.workspaces.find((w) => w.id === signedIn.user.workspaceId)!.kind).toBe("personal")
		expect(appleIdentitiesOf(built, signedIn.user.id)).toEqual([
			{ userId: signedIn.user.id, provider: "apple", subject: "001234.apple.0001", email: "person@acme.test" },
		])
		expect(built.gateway.emailProofs.has(signedIn.user.id)).toBe(true)
		expect(built.gateway.users.find((user) => user.id === signedIn.user.id)!.passwordHash).toBeNull()
		expect(built.gateway.wokenFor).toContain(signedIn.user.id)
	})

	it("names someone who shared no name by their address, and a Hide My Email address generically", async () => {
		const built = build()
		const plain = await built.usecase.signInWithApple({ profile: apple() })
		const hidden = await built.usecase.signInWithApple({
			profile: apple({ sub: "001234.apple.0002", email: RELAY, relay: true }),
		})
		expect(plain.user.name).toBe("person")
		expect(hidden.user.name).toBe("Apple user")
		expect(hidden.user.email).toBe(RELAY)
	})

	it("signs a later sign-in in by its Apple subject, with no address and a changed address alike", async () => {
		const built = build()
		const first = await built.usecase.signInWithApple({ profile: apple(), name: "Pat Lee" })

		const withoutEmail = await built.usecase.signInWithApple({ profile: apple({ email: null }) })
		expect(withoutEmail.user.id).toBe(first.user.id)

		const moved = await built.usecase.signInWithApple({ profile: apple({ email: "pat@elsewhere.test" }) })
		expect(moved.user.id).toBe(first.user.id)
		expect(moved.user.email).toBe("person@acme.test")
		expect(appleIdentitiesOf(built, first.user.id)).toEqual([
			expect.objectContaining({ subject: "001234.apple.0001", email: "pat@elsewhere.test" }),
		])
		expect(built.gateway.users).toHaveLength(1)
	})

	it("records the proof again when a known identity's token carries the account's own address", async () => {
		const built = build()
		const first = await built.usecase.signInWithApple({ profile: apple() })
		built.gateway.emailProofs.clear()

		await built.usecase.signInWithApple({ profile: apple({ email: "pat@elsewhere.test" }) })
		expect(built.gateway.emailProofs.has(first.user.id)).toBe(false)

		await built.usecase.signInWithApple({ profile: apple({ email: "PERSON@acme.test" }) })
		expect(built.gateway.emailProofs.has(first.user.id)).toBe(true)
	})

	it("refuses a new Apple identity that shares no verified address, and creates nothing", async () => {
		const built = build()
		await expect(built.usecase.signInWithApple({ profile: apple({ email: null }) })).rejects.toBeInstanceOf(
			AppleEmailRequiredError,
		)
		expect(built.gateway.users).toHaveLength(0)
	})

	it("refuses a removed account and mints it no session", async () => {
		const built = build()
		const first = await built.usecase.signInWithApple({ profile: apple() })
		built.gateway.users.find((row) => row.id === first.user.id)!.hasLiveMembership = false
		const sessionsBefore = built.gateway.sessions.length

		await expect(built.usecase.signInWithApple({ profile: apple() })).rejects.toThrow(
			"This account was removed from its Workspace.",
		)
		expect(built.gateway.sessions).toHaveLength(sessionsBefore)
	})

	it("adopts a password account nobody proved the address of, ending everything that password could open", async () => {
		const built = build()
		const squatter = await built.usecase.signUp({ email: "person@acme.test", name: "Squatter", password: PASSWORD })

		const signedIn = await built.usecase.signInWithApple({ profile: apple() })

		expect(signedIn.user.id).toBe(squatter.user.id)
		expect(built.gateway.unprovenAccessEndedFor).toEqual([squatter.user.id])
		expect(built.gateway.users[0]!.passwordHash).toBeNull()
		expect(appleIdentitiesOf(built, squatter.user.id)).toHaveLength(1)
		expect(built.gateway.emailProofs.has(squatter.user.id)).toBe(true)
		await expect(built.usecase.signIn({ email: "person@acme.test", password: PASSWORD })).rejects.toThrow(
			"Email or password is incorrect.",
		)
	})

	it.each([
		["a proven password account", (built: Built, id: string) => built.gateway.emailProofs.add(id)],
		[
			"an account with no password",
			(built: Built, id: string) => {
				built.gateway.users.find((user) => user.id === id)!.passwordHash = null
			},
		],
		[
			"an account seeded for a Google claim",
			(built: Built, id: string) => {
				built.gateway.users.find((user) => user.id === id)!.passwordHash = GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL
			},
		],
	] as const)("leaves %s to its owner, who connects Apple from Settings", async (_name, arrange) => {
		const built = build()
		const owner = await built.usecase.signUp({ email: "person@acme.test", name: "Owner", password: PASSWORD })
		arrange(built, owner.user.id)
		const passwordHash = built.gateway.users[0]!.passwordHash

		const refused = built.usecase.signInWithApple({ profile: apple() })
		await expect(refused).rejects.toBeInstanceOf(AppleAuthConflictError)
		await expect(refused).rejects.toMatchObject({ appleCode: "apple_account_exists" })
		expect(built.gateway.users[0]!.passwordHash).toBe(passwordHash)
		expect(built.gateway.unprovenAccessEndedFor).toEqual([])
		expect(appleIdentitiesOf(built, owner.user.id)).toEqual([])
	})

	it("turns the row a Team's share left for the address into the person's own account", async () => {
		const built = build()
		const { workspaceId } = await acmeTeam(built)
		const row = await built.gateway.createUser({
			workspaceId,
			email: "person@acme.test",
			name: "person@acme.test",
			passwordHash: GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
			isAdmin: false,
		})
		built.gateway.users.find((user) => user.id === row.id)!.unclaimed = true

		const signedIn = await built.usecase.signInWithApple({ profile: apple(), name: "Pat Lee" })

		expect(signedIn.user.id).toBe(row.id)
		const claimed = built.gateway.users.find((user) => user.id === row.id)!
		expect(claimed).toMatchObject({ unclaimed: false, passwordHash: null, name: "Pat Lee", liveTeamId: null })
		expect(built.gateway.workspaces.find((workspace) => workspace.id === claimed.workspaceId)!.kind).toBe("personal")
		expect(appleIdentitiesOf(built, row.id)).toHaveLength(1)
		expect(built.gateway.emailProofs.has(row.id)).toBe(true)
	})

	it("accepts the Invite waiting for the address instead of making a Workspace of its own", async () => {
		const built = build()
		const { workspaceId, admin } = await acmeTeam(built)
		built.gateway.seedInvite({
			workspaceId,
			email: "person@acme.test",
			role: "member",
			tokenHash: "a".repeat(64),
			invitedBy: admin.id,
		})
		const workspacesBefore = built.gateway.workspaces.length

		const signedIn = await built.usecase.signInWithApple({ profile: apple() })

		expect(signedIn.user).toMatchObject({ workspaceId, isAdmin: false })
		expect(built.gateway.workspaces).toHaveLength(workspacesBefore)
		expect(built.gateway.invites).toHaveLength(0)
		expect(built.ledgerCalls.map((call) => call.action)).toContain("workspace.invite.accept")
	})

	it("leaves an Invite to another address alone when the person signs in with Hide My Email", async () => {
		const built = build()
		const { workspaceId, admin } = await acmeTeam(built)
		built.gateway.seedInvite({
			workspaceId,
			email: "person@acme.test",
			role: "member",
			tokenHash: "a".repeat(64),
			invitedBy: admin.id,
		})

		const signedIn = await built.usecase.signInWithApple({ profile: apple({ email: RELAY, relay: true }) })

		expect(signedIn.user.workspaceId).not.toBe(workspaceId)
		expect(built.gateway.invites).toHaveLength(1)
	})

	it("turns a Member's Invite that waits for an Admin into a Join Request holding the Apple subject", async () => {
		const built = build()
		const { workspaceId, admin } = await acmeTeam(built)
		built.joins.joining.add(workspaceId, { joinApproval: "admin" })
		built.gateway.seedInvite({
			workspaceId,
			email: "person@acme.test",
			via: "member_invite",
			tokenHash: "b".repeat(64),
			invitedBy: admin.id,
		})

		await expect(built.usecase.signInWithApple({ profile: apple() })).rejects.toBeInstanceOf(JoinPendingError)

		expect(built.joins.requests.rows).toEqual([
			expect.objectContaining({
				email: "person@acme.test",
				passwordHash: null,
				googleSubject: null,
				appleSubject: "001234.apple.0001",
				emailVerified: false,
				via: "member_invite",
			}),
		])
		expect(built.gateway.users.some((user) => user.email === "person@acme.test")).toBe(false)
		await expect(built.usecase.signInWithApple({ profile: apple() })).rejects.toBeInstanceOf(JoinPendingError)
	})

	it("offers the Workspace its domain names, and joins it only when the person says so", async () => {
		const built = build()
		const { workspaceId } = await acmeTeam(built)
		built.joins.joining.add(workspaceId, { allowedDomain: "acme.test", joinMode: "domain", joinApproval: "auto" })

		const offered = built.usecase.signInWithApple({ profile: apple() })
		await expect(offered).rejects.toBeInstanceOf(JoinOfferedError)
		await expect(offered).rejects.toMatchObject({ workspaceId })
		expect(built.gateway.users.some((user) => user.email === "person@acme.test")).toBe(false)

		const joined = await built.usecase.signInWithApple({ profile: apple(), choice: { join: workspaceId } })
		expect(joined.user).toMatchObject({ workspaceId, isAdmin: false })
		expect(appleIdentitiesOf(built, joined.user.id)).toHaveLength(1)
		expect(built.gateway.emailProofs.has(joined.user.id)).toBe(true)
		expect(built.ledgerCalls.map((call) => call.action)).toContain("workspace.domain.join")
	})

	it("lets a person turn the domain offer down and create their own Workspace", async () => {
		const built = build()
		const { workspaceId } = await acmeTeam(built)
		built.joins.joining.add(workspaceId, { allowedDomain: "acme.test", joinMode: "domain", joinApproval: "auto" })

		const signedIn = await built.usecase.signInWithApple({ profile: apple(), choice: "create" })

		expect(signedIn.user.workspaceId).not.toBe(workspaceId)
		expect(signedIn.user.isAdmin).toBe(true)
	})

	it("opens a Join Request holding the Apple subject when the domain's Workspace approves by hand", async () => {
		const built = build()
		const { workspaceId } = await acmeTeam(built)
		built.joins.joining.add(workspaceId, { allowedDomain: "acme.test", joinMode: "domain", joinApproval: "admin" })

		await expect(
			built.usecase.signInWithApple({ profile: apple(), choice: { join: workspaceId } }),
		).rejects.toBeInstanceOf(JoinPendingError)
		expect(built.joins.requests.rows).toEqual([
			expect.objectContaining({ appleSubject: "001234.apple.0001", googleSubject: null, emailVerified: false }),
		])

		await built.joins.requests.decline(built.joins.requests.rows[0]!.id, workspaceId)
		await expect(built.usecase.signInWithApple({ profile: apple() })).rejects.toBeInstanceOf(JoinDeclinedError)
	})

	it("never offers a domain join to Hide My Email, even where a Workspace names Apple's relay domain", async () => {
		const built = build()
		const { workspaceId } = await acmeTeam(built)
		built.joins.joining.add(workspaceId, {
			allowedDomain: "privaterelay.appleid.com",
			joinMode: "domain",
			joinApproval: "auto",
		})

		const signedIn = await built.usecase.signInWithApple({ profile: apple({ email: RELAY, relay: true }) })

		expect(signedIn.user.workspaceId).not.toBe(workspaceId)
		expect(built.gateway.workspaces.find((w) => w.id === signedIn.user.workspaceId)!.kind).toBe("personal")
	})

	it("creates no account while sign-up is closed", async () => {
		const built = build({ signUpMode: "invite" })
		await built.usecase.signUp({ email: "first@acme.test", name: "First", password: PASSWORD })

		await expect(built.usecase.signInWithApple({ profile: apple() })).rejects.toBeInstanceOf(SignUpInviteOnlyError)
		expect(built.gateway.users).toHaveLength(1)
	})

	it("leaves Google's answers to an Apple-made account as they are for any proven one", async () => {
		const built = build()
		await built.usecase.signInWithApple({ profile: apple() })

		await expect(
			built.usecase.signInWithGoogle({ profile: { sub: "google-sub", email: "person@acme.test" } }),
		).rejects.toBeInstanceOf(GoogleAuthConflictError)
	})
})

describe("Email Sign-in for an Apple account", () => {
	it("refuses an account made by Apple once its Apple ID reports another address", async () => {
		const built = build()
		const first = await built.usecase.signInWithApple({ profile: apple() })
		await built.usecase.signInWithApple({ profile: apple({ email: "pat@elsewhere.test" }) })
		const sessionsBefore = built.gateway.sessions.length

		await expect(built.usecase.signInWithVerifiedEmail({ email: "person@acme.test" })).rejects.toThrow(
			"This account now signs in with a different Apple address. Sign in with Apple.",
		)
		expect(built.gateway.sessions).toHaveLength(sessionsBefore)
		expect((await built.usecase.signInWithApple({ profile: apple({ email: null }) })).user.id).toBe(first.user.id)
	})

	it("signs an account in by email while its Apple identity still carries its address, or a Hide My Email one", async () => {
		const built = build()
		const appleMade = await built.usecase.signInWithApple({ profile: apple() })
		const emailed = await built.usecase.signInWithVerifiedEmail({ email: "person@acme.test" })
		expect("user" in emailed && emailed.user.id).toBe(appleMade.user.id)

		const other = await built.usecase.signInWithVerifiedEmail({ email: "other@acme.test" })
		if (!("user" in other)) throw new Error("expected a sign-in")
		await built.usecase.linkAppleIdentity({
			userId: other.user.id,
			profile: apple({ sub: "001234.apple.0002", email: RELAY, relay: true }),
		})
		const again = await built.usecase.signInWithVerifiedEmail({ email: "other@acme.test" })
		expect("user" in again && again.user.id).toBe(other.user.id)
	})
})

describe("AuthUsecase.linkAppleIdentity", () => {
	it("connects Apple to a signed-in account, which `me` then reports", async () => {
		const built = build()
		const owner = await built.usecase.signUp({ email: "person@acme.test", name: "Owner", password: PASSWORD })
		expect((await built.usecase.me(owner.user)).appleLinked).toBe(false)

		await built.usecase.linkAppleIdentity({ userId: owner.user.id, profile: apple({ email: RELAY, relay: true }) })

		expect((await built.usecase.me(owner.user)).appleLinked).toBe(true)
		expect(built.gateway.emailProofs.has(owner.user.id)).toBe(false)
		expect((await built.usecase.signInWithApple({ profile: apple({ email: null }) })).user.id).toBe(owner.user.id)
	})

	it("proves the account's address when Apple's verified address is that one", async () => {
		const built = build()
		const owner = await built.usecase.signUp({ email: "person@acme.test", name: "Owner", password: PASSWORD })

		await built.usecase.linkAppleIdentity({ userId: owner.user.id, profile: apple() })

		expect(built.gateway.emailProofs.has(owner.user.id)).toBe(true)
		expect(built.gateway.wokenFor).toContain(owner.user.id)
	})

	it("refuses an Apple identity another account holds, and a token with no verified address", async () => {
		const built = build()
		await built.usecase.signInWithApple({ profile: apple() })
		const other = await built.usecase.signUp({ email: "other@acme.test", name: "Other", password: PASSWORD })

		const taken = built.usecase.linkAppleIdentity({ userId: other.user.id, profile: apple() })
		await expect(taken).rejects.toBeInstanceOf(AppleAuthConflictError)
		await expect(taken).rejects.toMatchObject({ appleCode: "apple_already_linked" })
		await expect(
			built.usecase.linkAppleIdentity({ userId: other.user.id, profile: apple({ sub: "s2", email: null }) }),
		).rejects.toBeInstanceOf(AppleEmailRequiredError)
		expect(appleIdentitiesOf(built, other.user.id)).toEqual([])
	})
})
