import { randomUUID } from "node:crypto"

import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { describe, expect, it } from "vitest"

import { GrantsUsecase } from "../grants.usecase"

import { AuthUsecase } from "./auth.usecase"
import {
	dormantRows,
	inApi,
	invite,
	me,
	PASSWORD,
	published,
	resultOf,
	switchTo,
	teamOwner,
	titles,
} from "./personal-signup.fixtures"

import type { Sql } from "postgres"

/** As index.ts wires Community without Google: shares make rows for unknown emails, and nothing proves one. */
const communityGrants = (sql: Sql) =>
	new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql), {
		inviteByEmail: true,
		emailProof: false,
		tx: new TransactionProvider(sql),
		ledger: new LedgerService(new LedgerRepository(sql)),
	})

const communityAuth = (sql: Sql) =>
	new AuthUsecase(
		new AuthRepository(sql),
		new PasswordService(),
		new SessionTokenService(),
		new TransactionProvider(sql),
		{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
		3600,
		{ ledger: new LedgerService(new LedgerRepository(sql)), emailProof: false, inviteByEmail: true },
	)

describe("a password claim on an install that cannot prove an email", () => {
	it("keeps another Team's share from whoever claims the address through their own Team's Join Link", () =>
		inApi(async (sql, api) => {
			const teamA = await teamOwner(api, "owner@a.test", "Team A")
			const teamB = await teamOwner(api, "admin@b.test", "Team B")
			const fileA = await published(sql, { workspaceId: teamA.teamId, ownerId: teamA.user.id, title: "Team A memo" })
			const fileB = await published(sql, { workspaceId: teamB.teamId, ownerId: teamB.user.id, title: "Team B memo" })
			const grants = communityGrants(sql)
			const grantA = await grants.create(teamA.user.id, {
				artifactId: fileA,
				granteeEmail: "new@x.test",
				role: "view",
			})
			const grantB = await grants.create(teamB.user.id, {
				artifactId: fileB,
				granteeEmail: "new@x.test",
				role: "view",
			})
			const token = await invite(sql, teamB.teamId, teamB.user.id, "new@x.test")

			const joined = await communityAuth(sql).signUp({
				email: "new@x.test",
				name: "Not new",
				password: PASSWORD,
				inviteToken: token,
			})

			expect(joined.user).toMatchObject({ id: grantA.grantee.id, workspaceId: teamB.teamId })
			const rows = await dormantRows(sql, joined.user.id)
			expect(Object.fromEntries(rows.map((row) => [row.id, row.dormant]))).toEqual({
				[grantA.id]: true,
				[grantB.id]: false,
			})
			const read = await api.call({ method: "GET", path: `/v1/artifacts/${fileA}`, token: joined.token })
			const missing = await api.call({ method: "GET", path: `/v1/artifacts/${randomUUID()}`, token: joined.token })
			expect([read.status, read.body]).toEqual([missing.status, missing.body])
			const readB = await api.call({ method: "GET", path: `/v1/artifacts/${fileB}`, token: joined.token })
			expect(resultOf<{ title: string }>(readB).title).toBe("Team B memo")
			expect(await titles(api, joined.token, "all")).toEqual(["Team B memo"])

			const personal = (await me(api, joined.token)).workspaces.find((w) => w.kind === "personal")!.id
			resultOf(await switchTo(api, joined.token, personal))
			expect(await titles(api, joined.token, "sharedWithMe")).toEqual([])
			const readInPersonal = await api.call({ method: "GET", path: `/v1/artifacts/${fileA}`, token: joined.token })
			const missingInPersonal = await api.call({
				method: "GET",
				path: `/v1/artifacts/${randomUUID()}`,
				token: joined.token,
			})
			expect([readInPersonal.status, readInPersonal.body]).toEqual([missingInPersonal.status, missingInPersonal.body])
		}))
})
