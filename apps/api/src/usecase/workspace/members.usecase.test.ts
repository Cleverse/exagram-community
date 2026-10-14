import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { inlineTx } from "@exagram/core/test/tx"
import { ConflictError } from "@exagram/core/utils/errors"
import { REFUSAL_TEXT, RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway, StartCallParams } from "@exagram/core/datagateway/ledger.datagateway"

import { FakeAuthDatagateway } from "../auth/auth.datagateway.fake"

import { FakeMembersDatagateway } from "./members.datagateway.fake"
import { MembersUsecase } from "./members.usecase"

const RANDOM_ID = "9f1c2b3a-4d5e-4f60-8a7b-0c1d2e3f4a5b"

const build = async (lastAdminMessage?: string) => {
	const auth = new FakeAuthDatagateway()
	const workspace = await auth.createWorkspace("Acme")
	const other = await auth.createWorkspace("Other")
	const person = (workspaceId: string, name: string, isAdmin: boolean) =>
		auth.createUser({ workspaceId, email: `${name.toLowerCase()}@acme.test`, name, passwordHash: "hash", isAdmin })
	const owner = await person(workspace.id, "Olive", true)
	await auth.setWorkspaceOwner(workspace.id, owner.id)
	const admin = await person(workspace.id, "Ada", true)
	const member = await person(workspace.id, "Mo", false)
	const stranger = await person(other.id, "Sam", false)
	const members = new FakeMembersDatagateway(auth)
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
	const revoked: string[] = []
	const usecase = new MembersUsecase(
		auth,
		members,
		new LedgerService(ledgerGateway),
		inlineTx(),
		{
			revokeGrant: (grantId) => {
				revoked.push(grantId)
				return Promise.resolve()
			},
		},
		lastAdminMessage,
	)
	return { auth, workspace, other, owner, admin, member, stranger, members, calls, revoked, usecase }
}

const refusalOf = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	)
	expect(error).toBeInstanceOf(RefusalError)
	return { name: (error as Error).name, message: (error as Error).message }
}

describe("MembersUsecase.list", () => {
	it("gives a Member names, emails, roles and the Workspace Owner flag, and no Admin-only field", async () => {
		const { usecase, member, owner } = await build()

		const list = await usecase.list(member)

		expect(list.view).toBe("member")
		expect(list.items.map((item) => item.name)).toEqual(["Olive", "Ada", "Mo"])
		for (const item of list.items) {
			expect(Object.keys(item).sort()).toEqual(["email", "id", "joinedAt", "name", "role", "workspaceOwner"])
		}
		expect(list.items.find((item) => item.workspaceOwner)?.id).toBe(owner.id)
	})

	it("gives an Admin last active and the counts", async () => {
		const { usecase, admin, members, member } = await build()
		members.owned.set(member.id, 2)

		const list = await usecase.list(admin)

		expect(list.view).toBe("admin")
		expect(list.items.find((item) => item.id === member.id)).toMatchObject({ projectCount: 2, connectionCount: 0 })
	})

	it("leaves out a Removed Member", async () => {
		const { usecase, admin, member } = await build()
		await usecase.remove(admin, member.id, undefined)

		const list = await usecase.list(admin)

		expect(list.items.map((item) => item.id)).not.toContain(member.id)
	})
})

describe("MembersUsecase.setRole", () => {
	it("promotes and demotes, recording each change with the target as subject", async () => {
		const { usecase, admin, member, auth, calls } = await build()

		await expect(usecase.setRole(admin, member.id, "admin")).resolves.toMatchObject({ role: "admin" })
		expect((await auth.getUserById(member.id))?.isAdmin).toBe(true)
		await usecase.setRole(admin, member.id, "member")

		expect((await auth.getUserById(member.id))?.isAdmin).toBe(false)
		expect(calls.map(({ action, subject }) => ({ action, subject }))).toEqual([
			{ action: "workspace.member.role.admin", subject: member.id },
			{ action: "workspace.member.role.member", subject: member.id },
		])
	})

	it("records nothing when the role is already that", async () => {
		const { usecase, admin, member, calls } = await build()

		await usecase.setRole(admin, member.id, "member")

		expect(calls).toEqual([])
	})

	it("refuses the Workspace Owner, a missing id and a Member elsewhere with the same refusal", async () => {
		const { usecase, admin, owner, stranger } = await build()

		const forOwner = await refusalOf(usecase.setRole(admin, owner.id, "member"))
		const forMissing = await refusalOf(usecase.setRole(admin, RANDOM_ID, "member"))
		const forStranger = await refusalOf(usecase.setRole(admin, stranger.id, "member"))

		expect(forOwner).toEqual({ name: "RefusalError", message: REFUSAL_TEXT })
		expect(forStranger).toEqual(forMissing)
		expect(forOwner).toEqual(forMissing)
	})

	it("refuses a Member who is not an Admin", async () => {
		const { usecase, member, admin } = await build()

		await refusalOf(usecase.setRole(member, admin.id, "member"))
	})

	it("refuses to demote the last Admin of a Workspace with no Workspace Owner", async () => {
		const { usecase, admin, owner, auth, workspace } = await build()
		auth.workspaceOwners.delete(workspace.id)
		await usecase.setRole(admin, owner.id, "member")

		await expect(usecase.setRole(admin, admin.id, "member")).rejects.toBeInstanceOf(ConflictError)
		expect((await auth.getUserById(admin.id))?.isAdmin).toBe(true)
	})

	it("says the edition's sentence when the last Admin would go", async () => {
		const { usecase, admin, owner, auth, workspace } = await build("There must be at least one Admin.")
		auth.workspaceOwners.delete(workspace.id)
		await usecase.setRole(admin, owner.id, "member")
		await expect(usecase.setRole(admin, admin.id, "member")).rejects.toThrow("There must be at least one Admin.")
	})
})

describe("MembersUsecase in the Workspace the session acts in", () => {
	it("treats an Admin who is a plain Member where their session acts as that Member", async () => {
		const { usecase, auth, admin, other, stranger, members } = await build()
		auth.addMembership(admin.id, other.id)
		const inOther = { id: admin.id, workspaceId: other.id }

		const list = await usecase.list(inOther)

		expect(list.view).toBe("member")
		expect(list.items.map((item) => item.name)).toEqual(["Sam"])
		await refusalOf(usecase.setRole(inOther, stranger.id, "admin"))
		await refusalOf(usecase.remove(inOther, stranger.id, undefined))
		expect((await auth.getUserById(stranger.id))?.isAdmin).toBe(false)
		expect(members.removed).toEqual([])
	})

	it("lets an Admin there act, ledgering it under that Workspace", async () => {
		const { usecase, auth, other, stranger, calls, members } = await build()
		const boss = await auth.createUser({
			workspaceId: other.id,
			email: "boss@other.test",
			name: "Bo",
			passwordHash: "hash",
			isAdmin: true,
		})

		await usecase.setRole(boss, stranger.id, "admin")
		await usecase.remove(boss, stranger.id, undefined)

		expect(members.removed).toEqual([stranger.id])
		expect(calls.map(({ principalId, workspaceId }) => ({ principalId, workspaceId }))).toEqual([
			{ principalId: boss.id, workspaceId: other.id },
			{ principalId: boss.id, workspaceId: other.id },
		])
	})

	it("refuses a Workspace the caller holds no live membership of exactly like a random one", async () => {
		const { usecase, admin, other, member, members } = await build()
		const refused = async (workspaceId: string) => [
			await refusalOf(usecase.list({ id: admin.id, workspaceId })),
			await refusalOf(usecase.setRole({ id: admin.id, workspaceId }, member.id, "admin")),
			await refusalOf(usecase.remove({ id: admin.id, workspaceId }, member.id, undefined)),
		]

		expect(await refused(other.id)).toEqual(await refused(RANDOM_ID))
		expect(members.removed).toEqual([])
	})
})

describe("MembersUsecase.remove", () => {
	it("removes a Member who owns nothing and destroys their OIDC grants after commit", async () => {
		const { usecase, admin, member, members, auth, revoked, calls } = await build()
		members.oidcGrants.set(member.id, ["grant-1"])
		await auth.createSession({ userId: member.id, tokenHash: "t", expiresAt: new Date(Date.now() + 60_000) })

		await expect(usecase.remove(admin, member.id, undefined)).resolves.toEqual({ id: member.id })

		expect(await auth.getUserBySessionTokenHash("t")).toBeNull()
		expect(revoked).toEqual(["grant-1"])
		expect(calls.map(({ action, subject }) => ({ action, subject }))).toEqual([
			{ action: "workspace.member.remove", subject: member.id },
		])
	})

	it("requires transferTo when the Member owns something, then hands it over", async () => {
		const { usecase, admin, member, members, calls } = await build()
		members.owned.set(member.id, 1)

		await expect(usecase.remove(admin, member.id, undefined)).rejects.toMatchObject({
			code: "TRANSFER_REQUIRED",
			statusCode: 409,
		})
		expect(members.removed).toEqual([])
		await usecase.remove(admin, member.id, admin.id)

		expect(members.transfers).toEqual([
			{ workspaceId: member.workspaceId, from: member.id, to: admin.id, renameSuffix: "Mo" },
		])
		expect(calls.map(({ action, subject }) => ({ action, subject }))).toEqual([
			{ action: "workspace.member.transfer", subject: admin.id },
			{ action: "workspace.member.remove", subject: member.id },
		])
	})

	it("refuses a transferTo outside the Workspace like a missing one", async () => {
		const { usecase, admin, member, members, stranger } = await build()
		members.owned.set(member.id, 1)

		expect(await refusalOf(usecase.remove(admin, member.id, stranger.id))).toEqual(
			await refusalOf(usecase.remove(admin, member.id, RANDOM_ID)),
		)
		await refusalOf(usecase.remove(admin, member.id, member.id))
		expect(members.removed).toEqual([])
	})

	it("refuses the Workspace Owner and a Member elsewhere exactly like a missing id", async () => {
		const { usecase, admin, owner, stranger, members } = await build()

		const forMissing = await refusalOf(usecase.remove(admin, RANDOM_ID, undefined))
		expect(await refusalOf(usecase.remove(admin, owner.id, undefined))).toEqual(forMissing)
		expect(await refusalOf(usecase.remove(admin, stranger.id, undefined))).toEqual(forMissing)
		expect(members.removed).toEqual([])
	})

	it("refuses removing yourself", async () => {
		const { usecase, admin } = await build()

		await expect(usecase.remove(admin, admin.id, undefined)).rejects.toBeInstanceOf(ConflictError)
	})
})
