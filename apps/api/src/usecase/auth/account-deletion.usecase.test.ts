import { BODY_DELETE_BATCH } from "@exagram/core/services/jobs.port"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { BadRequestError, ConflictError } from "@exagram/core/utils/errors"
import { describe, expect, it, vi } from "vitest"

import type {
	AccountDeletionDatagateway,
	DeletingAccount,
} from "@exagram/core/datagateway/account-deletion.datagateway"
import type { LedgerDatagateway } from "@exagram/core/datagateway/ledger.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"

import {
	AccountDeletionUsecase,
	CONFIRMATION_MISMATCH,
	TEAM_NEEDS_OWNER,
	type AccountDeletionDeps,
} from "./account-deletion.usecase"

const ADA = "00000000-0000-4000-8000-00000000000a"
const OLIVE = "00000000-0000-4000-8000-00000000000b"
const PERSONAL = "00000000-0000-4000-8000-0000000000a1"
const TEAM = "00000000-0000-4000-8000-0000000000b1"

const build = (options: {
	account?: Partial<DeletingAccount>
	team?: { ownerId: string | null; liveMembers: number }
	ownsInTeam?: boolean
	selfAdmin?: boolean
	admins?: number
	storageKeys?: Record<string, string[]>
	apple?: AccountDeletionDeps["apple"]
}) => {
	const log: string[] = []
	let open = false
	const inTx = (event: string) => log.push(`${event}${open ? "" : " (after commit)"}`)
	const account: DeletingAccount = {
		id: ADA,
		email: "Ada@Example.test",
		name: "Ada",
		appleSubject: null,
		personalWorkspaceId: PERSONAL,
		teamWorkspaceId: options.team ? TEAM : null,
		...options.account,
	}
	const accounts: AccountDeletionDatagateway = {
		lockAccount: () => Promise.resolve(account),
		lockWorkspace: () => Promise.resolve(options.team ?? null),
		deleteWorkspace: (workspaceId) => {
			inTx(`delete workspace ${workspaceId}`)
			return Promise.resolve({ storageKeys: options.storageKeys?.[workspaceId] ?? [] })
		},
		endAccount: (_account, name) => {
			inTx(`end account as ${name}`)
			return Promise.resolve({ oidcGrantIds: ["grant-personal"] })
		},
	}
	const members: AccountDeletionDeps["members"] = {
		lockTeamChange: (_workspaceId, ids) =>
			Promise.resolve({
				ownerId: OLIVE,
				members: ids.map((id) => ({
					id,
					name: id === ADA ? "Ada" : "Olive",
					email: "",
					isAdmin: id === ADA ? (options.selfAdmin ?? false) : true,
					joinedAt: new Date(),
				})),
			}),
		countAdmins: () => Promise.resolve(options.admins ?? 2),
		ownsAnything: () => Promise.resolve(options.ownsInTeam ?? false),
		transferOwnership: (input) => {
			inTx(`transfer ${input.from} to ${input.to}`)
			return Promise.resolve()
		},
		remove: (member) => {
			inTx(`remove ${member.userId} from ${member.workspaceId}`)
			return Promise.resolve({ oidcGrantIds: ["grant-team"] })
		},
	}
	const tx = {
		async atomic<T>(fn: () => Promise<T>): Promise<T> {
			open = true
			try {
				return await fn()
			} finally {
				open = false
			}
		},
	} as TransactionManager
	const ledger = new LedgerService({
		startCall: (params) => {
			inTx(`ledger ${params.action} ${params.subject ?? ""}`)
			return Promise.resolve("call")
		},
		recordServe: () => Promise.resolve(),
		markDelivered: () => Promise.resolve(),
		markFailed: () => Promise.resolve(),
		setBodyDigest: () => Promise.resolve(),
		listForArtifact: () => Promise.resolve([]),
		listActivity: () => Promise.resolve([]),
		listArtifactViewers: () => Promise.resolve([]),
	} satisfies LedgerDatagateway)
	const errors: string[] = []
	const usecase = new AccountDeletionUsecase({
		accounts,
		members,
		ledger,
		tx,
		oidcGrants: {
			revokeGrant: (grantId) => {
				inTx(`revoke ${grantId}`)
				return Promise.resolve()
			},
		},
		enqueueBodyDelete: (payload) => {
			inTx(`enqueue ${payload.storageKeys.length} keys`)
			return Promise.resolve()
		},
		apple: options.apple ?? null,
		logError: (event) => errors.push(event),
	})
	return { usecase, log, errors }
}

describe("AccountDeletionUsecase", () => {
	it("refuses a confirmation that is not the account's address, changing nothing", async () => {
		const { usecase, log } = build({})
		const error = await usecase.delete(ADA, { confirmEmail: "ada@example.tes" }).catch((caught: unknown) => caught)
		expect(error).toBeInstanceOf(BadRequestError)
		expect(error).toMatchObject({ statusCode: 400, message: CONFIRMATION_MISMATCH })
		expect(log).toEqual([])
	})

	it("accepts the address in any case with spaces around it", async () => {
		const { usecase, log } = build({})
		await usecase.delete(ADA, { confirmEmail: "  ada@EXAMPLE.test " })
		expect(log).toEqual([
			"end account as Deleted person",
			`delete workspace ${PERSONAL}`,
			"revoke grant-personal (after commit)",
		])
	})

	it("refuses a Workspace Owner whose Team has other Members", async () => {
		const { usecase, log } = build({ team: { ownerId: ADA, liveMembers: 2 } })
		const error = await usecase.delete(ADA, { confirmEmail: "ada@example.test" }).catch((caught: unknown) => caught)
		expect(error).toBeInstanceOf(ConflictError)
		expect(error).toMatchObject({ statusCode: 409, message: TEAM_NEEDS_OWNER })
		expect(log).toEqual([])
	})

	it("deletes a Team its Workspace Owner is alone in, after ending the account", async () => {
		const { usecase, log } = build({ team: { ownerId: ADA, liveMembers: 1 } })
		await usecase.delete(ADA, { confirmEmail: "ada@example.test" })
		expect(log).toEqual([
			"end account as Deleted person",
			`delete workspace ${TEAM}`,
			`delete workspace ${PERSONAL}`,
			"revoke grant-personal (after commit)",
		])
	})

	it("leaves a Team as an Admin's removal does, giving what they own to the Workspace Owner", async () => {
		const { usecase, log } = build({ team: { ownerId: OLIVE, liveMembers: 3 }, ownsInTeam: true })
		await usecase.delete(ADA, { confirmEmail: "ada@example.test" })
		expect(log).toEqual([
			`transfer ${ADA} to ${OLIVE}`,
			`ledger workspace.member.transfer ${OLIVE}`,
			`remove ${ADA} from ${TEAM}`,
			`ledger workspace.member.remove ${ADA}`,
			"end account as Deleted person",
			`delete workspace ${PERSONAL}`,
			"revoke grant-team (after commit)",
			"revoke grant-personal (after commit)",
		])
	})

	it("refuses to leave a Team without an Admin", async () => {
		const { usecase, log } = build({ team: { ownerId: OLIVE, liveMembers: 3 }, selfAdmin: true, admins: 1 })
		const error = await usecase.delete(ADA, { confirmEmail: "ada@example.test" }).catch((caught: unknown) => caught)
		expect(error).toMatchObject({ statusCode: 409, message: TEAM_NEEDS_OWNER })
		expect(log).toEqual([])
	})

	it("hands the deleted bodies to the worker in batches, inside the transaction", async () => {
		const keys = Array.from({ length: BODY_DELETE_BATCH + 1 }, (_, i) => `bodies/${i}`)
		const { usecase, log } = build({ storageKeys: { [PERSONAL]: [...keys, "bodies/0"] } })
		await usecase.delete(ADA, { confirmEmail: "ada@example.test" })
		expect(log.filter((event) => event.startsWith("enqueue"))).toEqual([
			`enqueue ${BODY_DELETE_BATCH} keys`,
			"enqueue 1 keys",
		])
	})

	it("revokes the Apple token with the app's code after commit", async () => {
		const revoke = vi.fn().mockResolvedValue(undefined)
		const { usecase } = build({ account: { appleSubject: "apple-sub" }, apple: { revoke } })
		await usecase.delete(ADA, { confirmEmail: "ada@example.test", appleAuthorizationCode: "code" })
		expect(revoke).toHaveBeenCalledExactlyOnceWith({ authorizationCode: "code", subject: "apple-sub" })
	})

	it("still deletes when Apple refuses, and says so in the log", async () => {
		const { usecase, log, errors } = build({
			account: { appleSubject: "apple-sub" },
			apple: { revoke: () => Promise.reject(new Error("invalid_grant")) },
		})
		await expect(
			usecase.delete(ADA, { confirmEmail: "ada@example.test", appleAuthorizationCode: "code" }),
		).resolves.toBeUndefined()
		expect(log).toContain("end account as Deleted person")
		expect(errors).toEqual(["account-deletion:apple-revoke"])
	})

	it("asks Apple nothing without a code or an Apple identity", async () => {
		const revoke = vi.fn()
		await build({ account: { appleSubject: "apple-sub" }, apple: { revoke } }).usecase.delete(ADA, {
			confirmEmail: "ada@example.test",
		})
		await build({ apple: { revoke } }).usecase.delete(ADA, {
			confirmEmail: "ada@example.test",
			appleAuthorizationCode: "code",
		})
		expect(revoke).not.toHaveBeenCalled()
	})
})
