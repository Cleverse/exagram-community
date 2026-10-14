import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { hashLinkToken } from "@exagram/core/services/link-token.service"
import { inlineTx } from "@exagram/core/test/tx"
import { BadRequestError, ConflictError, RateLimitedError, SeatsFullError } from "@exagram/core/utils/errors"
import { REFUSAL_TEXT, RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway, StartCallParams } from "@exagram/core/datagateway/ledger.datagateway"
import type { InviteEmailPayload } from "@exagram/core/services/invite-email.port"

import { FakeAuthDatagateway } from "../auth/auth.datagateway.fake"
import { INVITED_MEMBER_LIMIT, INVITED_MEMBER_WINDOW_MS } from "../invited-member-cap"

import { FakeInvitesDatagateway } from "./invites.datagateway.fake"
import { INVITE_RENEWAL_LIMIT, InvitesUsecase, type InvitesUsecaseOptions } from "./invites.usecase"
import { FakeJoiningDatagateway } from "./joining.datagateway.fake"

// The fake datagateways judge expiry against the real clock, so the usecase's clock must track it.
const NOW = new Date()
const SEVEN_DAYS = new Date(NOW.getTime() + 7 * 24 * 3600 * 1000)

const INVITES_BY_ANY_MEMBER: InvitesUsecaseOptions = { inviteRoles: ["admin", "member"], membersMayInvite: true }

const build = async ({
	mail = false,
	options = INVITES_BY_ANY_MEMBER,
}: { mail?: boolean; options?: InvitesUsecaseOptions } = {}) => {
	const auth = new FakeAuthDatagateway()
	const workspace = await auth.createWorkspace("Acme")
	const other = await auth.createWorkspace("Other")
	const admin = await auth.createUser({
		workspaceId: workspace.id,
		email: "admin@acme.test",
		name: "Ada Admin",
		passwordHash: "hash",
		isAdmin: true,
	})
	const member = await auth.createUser({
		workspaceId: workspace.id,
		email: "member@acme.test",
		name: "Mo",
		passwordHash: "hash",
		isAdmin: false,
	})
	const otherAdmin = await auth.createUser({
		workspaceId: other.id,
		email: "admin@other.test",
		name: "Otto",
		passwordHash: "hash",
		isAdmin: true,
	})
	const invites = new FakeInvitesDatagateway({
		[admin.id]: admin.name,
		[member.id]: member.name,
		[otherAdmin.id]: otherAdmin.name,
	})
	const joining = new FakeJoiningDatagateway(
		(workspaceId) =>
			auth.users.filter((user) => user.workspaceId === workspaceId && !user.unclaimed && user.hasLiveMembership)
				.length + invites.rows.filter((row) => row.workspaceId === workspaceId && row.expiresAt > new Date()).length,
	)
	joining.add(workspace.id)
	joining.add(other.id, { workspaceName: "Other" })
	const tx = inlineTx()
	const mailed: { payload: InviteEmailPayload; inTx: boolean }[] = []
	let depth = 0
	const atomic = tx.atomic.bind(tx)
	tx.atomic = async (fn) => {
		depth += 1
		try {
			return await atomic(fn)
		} finally {
			depth -= 1
		}
	}
	const mailer = mail
		? (payload: InviteEmailPayload) => {
				mailed.push({ payload, inTx: depth > 0 })
				return Promise.resolve()
			}
		: null
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
	/**
	 * The hourly cap on new invited Members: `sent` is what the count query answers; `steps` records lock, count and
	 * lookup order.
	 */
	const steps: string[] = []
	const cap = {
		sent: 0,
		lockInviteKey: vi.fn().mockImplementation((key: string) => {
			steps.push(`lock ${key}`)
			return Promise.resolve()
		}),
		countInvitedMembersBySenderSince: vi.fn().mockImplementation(() => {
			steps.push("count")
			return Promise.resolve(cap.sent)
		}),
	}
	const getUserByEmail = auth.getUserByEmail.bind(auth)
	vi.spyOn(auth, "getUserByEmail").mockImplementation((email: string) => {
		steps.push("lookup")
		return getUserByEmail(email)
	})
	const usecase = new InvitesUsecase(
		auth,
		invites,
		joining,
		new LedgerService(ledgerGateway),
		tx,
		"https://app.example.test",
		cap,
		mailer,
		() => NOW,
		options,
	)
	return {
		auth,
		workspace,
		other,
		admin,
		member,
		otherAdmin,
		invites,
		joining,
		mailed,
		calls,
		cap,
		steps,
		usecase,
		ledgerGateway,
	}
}

const tokenOf = (url: string | null) => url!.split("/join/")[1]!

describe("InvitesUsecase", () => {
	it("creates an Invite with a 7-day Join Link shown once, and ledgers it with the email", async () => {
		const { usecase, invites, admin, workspace, calls } = await build()
		const issued = await usecase.create(admin, { email: " New@Acme.test ", role: "admin" })

		expect(issued.url).toMatch(/^https:\/\/app\.example\.test\/join\/[A-Za-z0-9_-]{43}$/)
		expect(issued.emailQueued).toBe(false)
		expect(issued.invite).toMatchObject({
			email: "new@acme.test",
			role: "admin",
			via: "admin_invite",
			invitedByName: "Ada Admin",
			expiresAt: SEVEN_DAYS,
		})
		expect(invites.rows[0]).toMatchObject({ workspaceId: workspace.id, tokenHash: hashLinkToken(tokenOf(issued.url)) })
		expect(calls).toEqual([
			{
				principalKind: "user",
				principalId: admin.id,
				workspaceId: workspace.id,
				surface: "web",
				action: "workspace.invite.create",
				subject: "new@acme.test",
			},
		])
		const listed = await usecase.list(admin)
		expect(listed).toHaveLength(1)
		expect(JSON.stringify(listed)).not.toContain(tokenOf(issued.url))
	})

	it("counts toward the cap on new invited Members, under the sender's lock and before the email is looked up", async () => {
		const { usecase, admin, cap, steps } = await build()
		cap.sent = INVITED_MEMBER_LIMIT - 1
		await usecase.create(admin, { email: "new@acme.test", role: "member" })
		expect(steps).toEqual([`lock invited-member:sender:${admin.id}`, "count", "lookup"])
		expect(cap.countInvitedMembersBySenderSince).toHaveBeenCalledWith(
			admin.id,
			new Date(NOW.getTime() - INVITED_MEMBER_WINDOW_MS),
		)
	})

	it("refuses a sender at the cap the way sharing does, without saying whether the email has an account", async () => {
		const { usecase, admin, invites, calls, cap, steps } = await build()
		cap.sent = INVITED_MEMBER_LIMIT
		for (const email of ["new@acme.test", "admin@other.test"]) {
			await expect(usecase.create(admin, { email, role: "member" })).rejects.toThrow(
				new RateLimitedError("You have invited many new people in the last hour. Try again later."),
			)
		}
		expect(steps).not.toContain("lookup")
		expect(invites.rows).toEqual([])
		expect(calls).toEqual([])
	})

	it("refuses a second Invite for the same email, pointing an Admin at Copy new link, and ledgers it as a failed duplicate", async () => {
		const { usecase, admin, member, calls, ledgerGateway } = await build()
		await usecase.create(admin, { email: "new@acme.test", role: "member" })
		await expect(usecase.create(admin, { email: "NEW@acme.test", role: "member" })).rejects.toThrow(/Copy new link/)
		await expect(usecase.create(member, { email: "new@acme.test", role: "member" })).rejects.toThrow(
			new ConflictError("That email already has an invite."),
		)
		expect(calls.map(({ action, principalId, subject }) => ({ action, principalId, subject }))).toEqual([
			{ action: "workspace.invite.create", principalId: admin.id, subject: "new@acme.test" },
			{ action: "workspace.invite.duplicate", principalId: admin.id, subject: "new@acme.test" },
			{ action: "workspace.invite.duplicate", principalId: member.id, subject: "new@acme.test" },
		])
		expect(ledgerGateway.markFailed).toHaveBeenCalledTimes(2)
		expect(ledgerGateway.markDelivered).toHaveBeenCalledTimes(1)
	})

	it("ledgers a refused existing-account Invite as a failed call", async () => {
		const { usecase, admin, calls, ledgerGateway } = await build()
		await expect(usecase.create(admin, { email: "member@acme.test", role: "member" })).rejects.toBeInstanceOf(
			ConflictError,
		)

		expect(calls).toMatchObject([{ action: "workspace.invite.create", subject: "member@acme.test" }])
		expect(ledgerGateway.markFailed).toHaveBeenCalledTimes(1)
		expect(ledgerGateway.markDelivered).not.toHaveBeenCalled()
	})

	it("refuses only this Team's own member, so the answer says nothing about another Team", async () => {
		const { usecase, admin, auth, other } = await build()
		await expect(usecase.create(admin, { email: "member@acme.test", role: "member" })).rejects.toThrow(
			"That person is already a member.",
		)
		await expect(usecase.create(admin, { email: "admin@other.test", role: "member" })).resolves.toBeDefined()

		await auth.createUser({
			workspaceId: await auth.createPersonalWorkspace(),
			email: "solo@personal.test",
			name: "Solo",
			passwordHash: "hash",
			isAdmin: true,
		})
		await expect(usecase.create(admin, { email: "solo@personal.test", role: "member" })).resolves.toBeDefined()

		await auth.createUser({
			workspaceId: other.id,
			email: "shared@acme.test",
			name: "shared@acme.test",
			passwordHash: GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
			isAdmin: false,
		})
		auth.users.find((user) => user.email === "shared@acme.test")!.unclaimed = true
		await expect(usecase.create(admin, { email: "shared@acme.test", role: "member" })).resolves.toBeDefined()
	})

	it("renews with a new token and expiry, and revokes, each ledgered", async () => {
		const { usecase, admin, invites, calls } = await build()
		const created = await usecase.create(admin, { email: "new@acme.test", role: "member" })
		const renewed = await usecase.renew(admin, created.invite.id)
		expect(renewed.url).not.toBe(created.url)
		expect(invites.rows[0]!.tokenHash).toBe(hashLinkToken(tokenOf(renewed.url)))

		expect(await usecase.revoke(admin, created.invite.id)).toEqual({ id: created.invite.id })
		expect(invites.rows).toHaveLength(0)
		expect(calls.map((call) => [call.action, call.subject])).toEqual([
			["workspace.invite.create", "new@acme.test"],
			["workspace.invite.renew", "new@acme.test"],
			["workspace.invite.revoke", "new@acme.test"],
		])
	})

	it("refuses a Member while Member Invites is off, and another Workspace's Invite, like a missing one", async () => {
		const { usecase, admin, member, otherAdmin, calls, joining, workspace } = await build()
		const created = await usecase.create(admin, { email: "new@acme.test", role: "member" })
		await joining.update(workspace.id, { ...(await joining.get(workspace.id))!, memberInvites: false })

		await expect(usecase.create(member, { email: "x@acme.test", role: "member" })).rejects.toBeInstanceOf(RefusalError)
		await expect(usecase.list(member)).rejects.toBeInstanceOf(RefusalError)
		await expect(usecase.renew(member, created.invite.id)).rejects.toBeInstanceOf(RefusalError)
		await expect(usecase.revoke(member, created.invite.id)).rejects.toBeInstanceOf(RefusalError)
		await expect(usecase.renew(otherAdmin, created.invite.id)).rejects.toBeInstanceOf(RefusalError)
		await expect(usecase.revoke(otherAdmin, created.invite.id)).rejects.toBeInstanceOf(RefusalError)
		expect(await usecase.list(otherAdmin)).toEqual([])
		expect(calls).toHaveLength(1)
	})

	it("acts in the Workspace the caller's session names, with the role they hold there", async () => {
		const { usecase, auth, admin, other, invites, calls } = await build()
		const created = await usecase.create(admin, { email: "new@acme.test", role: "member" })
		auth.addMembership(admin.id, other.id)
		const inOther = { id: admin.id, workspaceId: other.id }

		await expect(usecase.list(inOther)).rejects.toBeInstanceOf(RefusalError)
		await expect(usecase.create(inOther, { email: "boss@acme.test", role: "admin" })).rejects.toBeInstanceOf(
			RefusalError,
		)
		await expect(usecase.renew(inOther, created.invite.id)).rejects.toBeInstanceOf(RefusalError)
		await expect(usecase.revoke(inOther, created.invite.id)).rejects.toBeInstanceOf(RefusalError)

		expect(invites.rows.map((row) => row.email)).toEqual(["new@acme.test"])
		expect(calls).toHaveLength(1)
	})

	it("refuses a Workspace the caller holds no live membership of exactly like a random one", async () => {
		const { usecase, admin, other, calls, invites } = await build()
		const created = await usecase.create(admin, { email: "new@acme.test", role: "member" })
		const refused = async (workspaceId: string) => {
			const caller = { id: admin.id, workspaceId }
			const refusals = await Promise.all(
				[
					() => usecase.list(caller),
					() => usecase.create(caller, { email: "x@acme.test", role: "member" }),
					() => usecase.renew(caller, created.invite.id),
					() => usecase.revoke(caller, created.invite.id),
				].map((call) =>
					call().then(
						() => null,
						(error: unknown) => error,
					),
				),
			)
			return refusals.map((error) => ({ name: (error as Error).name, message: (error as Error).message }))
		}

		expect(await refused(other.id)).toEqual(await refused("9f1c2b3a-4d5e-4f60-8a7b-0c1d2e3f4a5b"))
		expect(await refused(other.id)).toEqual(Array(4).fill({ name: "RefusalError", message: REFUSAL_TEXT }))
		expect(invites.rows).toHaveLength(1)
		expect(calls).toHaveLength(1)
	})

	it("lets a Member invite under Join Approval admin, since accepting it opens a Join Request", async () => {
		const { usecase, member, invites } = await build()
		const issued = await usecase.create(member, { email: "friend@acme.test", role: "member" })
		expect(issued.invite).toMatchObject({ email: "friend@acme.test", via: "member_invite" })
		expect(invites.rows).toHaveLength(1)
	})

	it("lets a Member invite as a Member under Member Invites, marked member_invite, but never as an Admin", async () => {
		const { usecase, member, invites, calls } = await build()
		const issued = await usecase.create(member, { email: "friend@acme.test", role: "member" })
		expect(issued.invite).toMatchObject({ email: "friend@acme.test", role: "member", via: "member_invite" })
		expect(invites.rows[0]).toMatchObject({ invitedBy: member.id, via: "member_invite" })
		expect(calls).toMatchObject([{ principalId: member.id, action: "workspace.invite.create" }])

		await expect(usecase.create(member, { email: "boss@acme.test", role: "admin" })).rejects.toBeInstanceOf(
			RefusalError,
		)
		expect(invites.rows).toHaveLength(1)
		await expect(usecase.list(member)).rejects.toBeInstanceOf(RefusalError)
	})

	it("refuses an Invite with the seat error once Members plus Invites reach the limit, and a revoke frees a Seat", async () => {
		const { usecase, admin, joining, workspace, invites, steps } = await build()
		joining.workspaces.get(workspace.id)!.seatLimit = 3
		const first = await usecase.create(admin, { email: "one@acme.test", role: "member" })
		steps.length = 0

		await expect(usecase.create(admin, { email: "two@acme.test", role: "member" })).rejects.toBeInstanceOf(
			SeatsFullError,
		)
		await expect(usecase.create(admin, { email: "two@acme.test", role: "member" })).rejects.toMatchObject({
			code: "SEATS_FULL",
			statusCode: 409,
		})
		expect(steps).toEqual([])
		expect(invites.rows).toHaveLength(1)

		await usecase.revoke(admin, first.invite.id)
		await expect(usecase.create(admin, { email: "two@acme.test", role: "member" })).resolves.toBeDefined()
	})

	it("treats a NULL Seat Limit as unlimited", async () => {
		const { usecase, admin, invites } = await build()
		for (let n = 0; n < 5; n += 1) await usecase.create(admin, { email: `p${n}@acme.test`, role: "member" })
		expect(invites.rows).toHaveLength(5)
	})

	it("with mail, enqueues the Invite email inside the transaction on create and renew, carrying the Join Link", async () => {
		const { usecase, admin, mailed } = await build({ mail: true })
		const created = await usecase.create(admin, { email: "new@acme.test", role: "member" })
		const renewed = await usecase.renew(admin, created.invite.id)

		expect(created.emailQueued).toBe(true)
		expect(renewed.emailQueued).toBe(true)
		expect(mailed).toHaveLength(2)
		expect(mailed.every((entry) => entry.inTx)).toBe(true)
		expect(mailed[0]!.payload).toEqual({
			inviteId: created.invite.id,
			tokenHash: hashLinkToken(tokenOf(created.url)),
			messageId: `<invite-${created.invite.id}-${hashLinkToken(tokenOf(created.url)).slice(0, 16)}@app.example.test>`,
			to: "new@acme.test",
			url: created.url,
			workspaceName: "Acme",
			invitedByName: "Ada Admin",
			role: "member",
			expiresAt: SEVEN_DAYS.toISOString(),
		})
		expect(mailed[1]!.payload.url).toBe(renewed.url)
	})

	it("makes the renewing Admin the inviter of a Member's Invite, in the response and the email", async () => {
		const { usecase, admin, member, mailed } = await build({ mail: true })
		const created = await usecase.create(member, { email: "friend@acme.test", role: "member" })
		const renewed = await usecase.renew(admin, created.invite.id)
		expect(renewed.invite).toMatchObject({ invitedByName: "Ada Admin", via: "admin_invite" })
		expect(renewed.invite).not.toHaveProperty("heldSeat")
		expect(mailed[1]!.payload.invitedByName).toBe("Ada Admin")
	})

	it("never spends the cap on new invited Members on a renewal, even with the sender at that cap", async () => {
		const { usecase, admin, cap, steps } = await build({ mail: true })
		const created = await usecase.create(admin, { email: "new@acme.test", role: "member" })
		cap.sent = INVITED_MEMBER_LIMIT
		steps.length = 0
		await expect(usecase.renew(admin, created.invite.id)).resolves.toBeDefined()
		expect(steps).toEqual([`lock invite-renewal:sender:${admin.id}`])
		expect(cap.countInvitedMembersBySenderSince).toHaveBeenCalledTimes(1)
	})

	it("with mail, caps renewals on their own counter, and without mail does not cap them", async () => {
		const mailing = await build({ mail: true })
		const created = await mailing.usecase.create(mailing.admin, { email: "new@acme.test", role: "member" })
		mailing.invites.renewals = INVITE_RENEWAL_LIMIT
		await expect(mailing.usecase.renew(mailing.admin, created.invite.id)).rejects.toThrow(
			new RateLimitedError("You have renewed many invites in the last hour. Try again later."),
		)
		expect(mailing.mailed).toHaveLength(1)

		const copyOnly = await build()
		const issued = await copyOnly.usecase.create(copyOnly.admin, { email: "new@acme.test", role: "member" })
		copyOnly.invites.renewals = INVITE_RENEWAL_LIMIT
		await expect(copyOnly.usecase.renew(copyOnly.admin, issued.invite.id)).resolves.toBeDefined()
	})

	it("counts only unexpired Invites as Seats, so renewing an expired one at the limit is refused and an unexpired one is not", async () => {
		const { usecase, admin, joining, workspace, invites } = await build()
		const lapsed = await usecase.create(admin, { email: "lapsed@acme.test", role: "member" })
		const live = await usecase.create(admin, { email: "live@acme.test", role: "member" })
		invites.rows.find((row) => row.id === lapsed.invite.id)!.expiresAt = new Date("2026-01-01T00:00:00Z")
		joining.workspaces.get(workspace.id)!.seatLimit = 3

		await expect(usecase.renew(admin, lapsed.invite.id)).rejects.toBeInstanceOf(SeatsFullError)
		await expect(usecase.renew(admin, live.invite.id)).resolves.toBeDefined()
		// inlineTx has no rollback, so the refused renewal's write is undone by hand; integration covers the real one.
		invites.rows.find((row) => row.id === lapsed.invite.id)!.expiresAt = new Date("2026-01-01T00:00:00Z")
		joining.workspaces.get(workspace.id)!.seatLimit = 4
		await expect(usecase.renew(admin, lapsed.invite.id)).resolves.toBeDefined()
	})

	it("with mail, mails a Member's Invite without showing the Member its Join Link, and shows an Admin theirs", async () => {
		const { usecase, admin, member, mailed } = await build({ mail: true })
		const sent = await usecase.create(member, { email: "friend@acme.test", role: "member" })
		const own = await usecase.create(admin, { email: "new@acme.test", role: "member" })

		expect(sent).toMatchObject({ url: null, emailQueued: true })
		expect(mailed[0]!.payload.url).toMatch(/\/join\//)
		expect(own.url).toBe(mailed[1]!.payload.url)
	})

	it("without mail, shows a Member the Join Link, since nobody else can deliver it", async () => {
		const { usecase, member } = await build()
		const sent = await usecase.create(member, { email: "friend@acme.test", role: "member" })
		expect(sent).toMatchObject({ url: expect.stringMatching(/\/join\//) as unknown, emailQueued: false })
	})

	it("without mail, enqueues nothing and still returns the Join Link once", async () => {
		const { usecase, admin, mailed } = await build()
		const issued = await usecase.create(admin, { email: "new@acme.test", role: "member" })
		expect(issued).toMatchObject({ emailQueued: false, url: expect.stringMatching(/\/join\//) as unknown })
		expect(mailed).toEqual([])
	})

	it("enqueues no email for an Invite it refuses", async () => {
		const { usecase, admin, mailed } = await build({ mail: true })
		await expect(usecase.create(admin, { email: "member@acme.test", role: "member" })).rejects.toBeInstanceOf(
			ConflictError,
		)
		expect(mailed).toEqual([])
	})
})

describe("edition rules", () => {
	it("refuses a role the edition does not invite, before it touches the Workspace or the cap", async () => {
		const { usecase, admin, steps } = await build({ options: { inviteRoles: ["member"], membersMayInvite: true } })
		await expect(usecase.create(admin, { email: "new@acme.test", role: "admin" })).rejects.toThrow(BadRequestError)
		expect(steps).toEqual([])
	})

	it("refuses every Member Invite as not found when the edition keeps Invites to Admins", async () => {
		const { usecase, admin, member, joining, invites, steps } = await build({
			options: { inviteRoles: ["member"], membersMayInvite: false },
		})
		const lock = vi.spyOn(joining, "lock")
		for (const role of ["member", "admin"] as const) {
			await expect(usecase.create(member, { email: "friend@acme.test", role })).rejects.toBeInstanceOf(RefusalError)
		}
		expect(lock).not.toHaveBeenCalled()
		expect(steps).toEqual([])
		expect(invites.rows).toEqual([])
		await expect(usecase.create(admin, { email: "friend@acme.test", role: "member" })).resolves.toMatchObject({
			invite: { role: "member" },
		})
	})

	it("invites admins and members, from Members too, when the options allow both", async () => {
		const { usecase, admin, member } = await build({
			options: { inviteRoles: ["admin", "member"], membersMayInvite: true },
		})
		await expect(usecase.create(admin, { email: "new@acme.test", role: "admin" })).resolves.toMatchObject({
			invite: { role: "admin" },
		})
		await expect(usecase.create(member, { email: "friend@acme.test", role: "member" })).resolves.toMatchObject({
			invite: { via: "member_invite" },
		})
	})
})
