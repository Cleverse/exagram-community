import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { hashLinkToken, mintLinkToken } from "@exagram/core/services/link-token.service"
import { withDb } from "@exagram/core/test/pg"
import { approveRevision, seedArtifact, seedProject, seedRevision } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { expect } from "vitest"

import type { Me } from "@exagram/core/entity/auth"

import { startSessionApi, type ApiResponse, type SessionApi } from "../../../test/sessionApi"
import { GrantsUsecase } from "../grants.usecase"

import type { SignedIn } from "./auth.usecase"
import type { Sql } from "postgres"

export const PASSWORD = "correct horse battery"

export const inApi = (run: (sql: Sql, api: SessionApi) => Promise<void>): Promise<void> =>
	withDb(async (sql) => {
		const api = await startSessionApi(sql)
		try {
			await run(sql, api)
		} finally {
			await api.close()
		}
	})

export const resultOf = <T>(response: ApiResponse): T => {
	expect(response.status, response.body).toBeLessThan(300)
	return response.json.result as T
}

export const me = async (api: SessionApi, token: string): Promise<Me> =>
	resultOf<Me>(await api.call({ method: "GET", path: "/v1/auth/me", token }))

export const sessionTokenOf = (response: ApiResponse): string => {
	const cookies = [response.setCookie ?? []].flat()
	const session = cookies.find((cookie) => cookie.startsWith("exagram_session="))
	if (session === undefined) throw new Error(`no session cookie in ${response.body}`)
	return session.slice("exagram_session=".length, session.indexOf(";"))
}

export const signUp = (api: SessionApi, email: string, name = email): Promise<SignedIn> =>
	api.auth.signUp({ email, name, password: PASSWORD })

export const teamOwner = async (api: SessionApi, email: string, teamName: string) => {
	const signedUp = await signUp(api, email)
	const team = await api.teams.create(signedUp.user, teamName)
	const inTeam = await api.auth.signIn({ email, password: PASSWORD })
	expect(inTeam.user.workspaceId).toBe(team.id)
	return { ...inTeam, teamId: team.id, personalId: signedUp.user.workspaceId }
}

export const invite = async (sql: Sql, workspaceId: string, invitedBy: string, email: string): Promise<string> => {
	const { token, tokenHash } = mintLinkToken()
	await sql`INSERT INTO exagram.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
		VALUES (${workspaceId}, ${email}, 'member', ${tokenHash}, ${invitedBy}, now() + interval '1 day')`
	return token
}

export const inviteExists = async (sql: Sql, token: string): Promise<boolean> =>
	(await sql`SELECT 1 FROM exagram.workspace_invites WHERE token_hash = ${hashLinkToken(token)}`).length === 1

export const published = async (
	sql: Sql,
	file: { workspaceId: string; ownerId: string; title: string },
): Promise<string> => {
	const artifactId = await seedArtifact(sql, file)
	await approveRevision(sql, artifactId, await seedRevision(sql, { artifactId, seq: 1, authorUserId: file.ownerId }))
	return artifactId
}

export const googleProfile = (email: string, sub = `sub-${email}`) => ({ sub, email, name: `Google ${email}` })

export const grantsFor = (sql: Sql) =>
	new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql), {
		inviteByEmail: true,
		emailProof: true,
		tx: new TransactionProvider(sql),
		ledger: new LedgerService(new LedgerRepository(sql)),
	})

export const titles = async (api: SessionApi, token: string, scope: "all" | "sharedWithMe") =>
	resultOf<{ items: { title: string }[] }>(
		await api.call({ method: "GET", path: `/v1/artifacts?scope=${scope}`, token }),
	)
		.items.map((item) => item.title)
		.sort()

export const proveEmail = (sql: Sql, userId: string) =>
	sql`INSERT INTO exagram.notification_email_confirmations (user_id, email, canonical_email, token_hash, expires_at, confirmed_at)
		SELECT u.id, lower(u.email::text), exagram.canonical_email_address(u.email::text), ${"proof-" + userId},
			now() + interval '1 day', now()
		FROM exagram.users u WHERE u.id = ${userId}`

export const switchTo = (api: SessionApi, token: string, workspaceId: string) =>
	api.call({ method: "POST", path: "/v1/auth/workspace", token, body: { workspaceId } })

export const shareFromPersonal = async (sql: Sql, api: SessionApi, email: string) => {
	const friend = await signUp(api, "friend@else.test")
	const file = await published(sql, {
		workspaceId: friend.user.workspaceId,
		ownerId: friend.user.id,
		title: "For the address",
	})
	await grantsFor(sql).create(friend.user.id, { artifactId: file, granteeEmail: email, role: "view" })
	return file
}

export const dormantRows = async (sql: Sql, granteeId: string) =>
	sql<{ id: string; dormant: boolean }[]>`SELECT id, dormant FROM exagram.grants WHERE grantee_id = ${granteeId}`

/** A password account (unproven) and a friend who shares a file and a folder with its email from Personal. */
export const sharedWithUnproven = async (sql: Sql, api: SessionApi) => {
	const person = await signUp(api, "person@else.test")
	const friend = await signUp(api, "friend@else.test")
	const file = await published(sql, {
		workspaceId: friend.user.workspaceId,
		ownerId: friend.user.id,
		title: "Dormant memo",
	})
	const folder = await seedProject(sql, {
		workspaceId: friend.user.workspaceId,
		ownerId: friend.user.id,
		name: "Dormant folder",
	})
	await published(sql, {
		workspaceId: friend.user.workspaceId,
		ownerId: friend.user.id,
		title: "Inside the folder",
	}).then((id) => sql`UPDATE exagram.artifacts SET project_id = ${folder} WHERE id = ${id}`)
	const grants = grantsFor(sql)
	const fileGrant = await grants.create(friend.user.id, {
		artifactId: file,
		granteeEmail: "person@else.test",
		role: "view",
	})
	const folderGrant = await grants.create(friend.user.id, {
		projectId: folder,
		granteeEmail: "person@else.test",
		role: "view",
	})
	return { person, friend, file, folder, fileGrant, folderGrant, grants }
}
