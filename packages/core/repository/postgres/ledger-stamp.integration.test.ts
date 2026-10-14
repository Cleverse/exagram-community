import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { anonymousReader } from "../../entity/principal"
import { LedgerService } from "../../services/ledger/ledger.service"
import { withDb } from "../../test/pg"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedGrant,
	seedLink,
	seedPersonalWorkspace,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "../../test/seed"
import { buildServeService } from "../../test/serve-fixtures"

import { LedgerRepository } from "./ledger.repository"
import { SearchRepository } from "./search.repository"

import type { Sql } from "postgres"

const seedWorld = async (sql: Sql) => {
	const published = async (workspaceId: string, ownerId: string, title: string) => {
		const artifact = await seedArtifact(sql, { workspaceId, ownerId, title })
		const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: ownerId })
		await approveRevision(sql, artifact, revision)
		return { artifact, revision }
	}
	const team = await seedWorkspace(sql, "Acme")
	const ada = await seedUser(sql, { workspaceId: team, email: "ada@acme.test", isAdmin: true })
	const personal = await seedPersonalWorkspace(sql, ada)
	const teamDoc = await published(team, ada, "Team plan")
	const personalDoc = await published(personal, ada, "Personal plan")

	const other = await seedWorkspace(sql, "Other")
	const gus = await seedUser(sql, { workspaceId: other, email: "gus@other.test" })
	const gusPersonal = await seedPersonalWorkspace(sql, gus)
	await seedGrant(sql, { artifactId: teamDoc.artifact, granteeId: gus, role: "view", createdBy: ada })
	return { team, ada, personal, teamDoc, personalDoc, other, gus, gusPersonal }
}

const stamp = async (sql: Sql, callId: string) =>
	(
		await sql<
			{ workspaceId: string | null }[]
		>`SELECT workspace_id AS "workspaceId" FROM exagram.ledger_calls WHERE id = ${callId}`
	)[0]!.workspaceId

const auditOf = async (sql: Sql, workspaceId: string) =>
	(await new LedgerRepository(sql).listActivity(workspaceId, 100, null)).map((row) => row.entry.callId).sort()

const callsOf = async (sql: Sql, action: string) =>
	(await sql<{ id: string }[]>`SELECT id FROM exagram.ledger_calls WHERE action = ${action}`)
		.map((row) => row.id)
		.sort()

describe("the Workspace a Ledger call is stamped with", () => {
	it("is the one a person's session names, even when it is not the account's home", () =>
		withDb(async (sql) => {
			const { team, ada, personal } = await seedWorld(sql)
			const ledger = new LedgerService(new LedgerRepository(sql))
			const [home] = await sql<{ workspaceId: string }[]>`SELECT exagram.home_workspace(${ada}) AS "workspaceId"`
			expect(home!.workspaceId).toBe(team)

			for (const workspaceId of [personal, team]) {
				const callId = await ledger.openCall({
					principal: { kind: "user", id: ada, workspaceId },
					surface: "web",
					action: "artifacts.list",
				})
				expect(await stamp(sql, callId)).toBe(workspaceId)
			}
		}))

	it("is carried by every read of ServeService", () =>
		withDb(async (sql) => {
			const { ada, personal, teamDoc } = await seedWorld(sql)
			const serve = buildServeService(sql)
			const principal = { kind: "user" as const, id: ada, workspaceId: personal }
			const read = { principal, surface: "web" as const, artifactId: teamDoc.artifact }

			await serve.resolve({ ...read, action: "t.resolve", requireRevision: true })
			await serve.serve({ ...read, action: "t.serve" }, () => Promise.resolve("body"))
			await serve.resolveList({
				principal,
				surface: "web",
				action: "t.list",
				resolve: () => Promise.resolve([teamDoc]),
				toServe: (row) => ({ artifactId: row.artifact, revisionId: row.revision }),
			})
			await serve.recordWithheld({ ...read, action: "t.withheld", reason: "out-of-boundary" })

			const calls = await sql<{ action: string; workspaceId: string }[]>`
				SELECT action, workspace_id AS "workspaceId" FROM exagram.ledger_calls ORDER BY action`
			expect(calls).toEqual(
				["t.list", "t.resolve", "t.serve", "t.withheld"].map((action) => ({ action, workspaceId: personal })),
			)
		}))

	it("is the Connection's own Workspace for a Connection call", () =>
		withDb(async (sql) => {
			const { team, ada, personal } = await seedWorld(sql)
			const ledger = new LedgerService(new LedgerRepository(sql))
			const inTeam = await seedConnection(sql, { userId: ada, workspaceId: team })
			const inPersonal = await seedConnection(sql, { userId: ada, workspaceId: personal })

			const call = (id: string) =>
				ledger.openCall({ principal: { kind: "connection", id }, surface: "mcp", action: "artifact_read" })
			expect(await stamp(sql, await call(inTeam))).toBe(team)
			expect(await stamp(sql, await call(inPersonal))).toBe(personal)
		}))

	it("is the Artifact's Workspace for a Link call and an anonymous call", () =>
		withDb(async (sql) => {
			const { team, ada, personal, teamDoc, personalDoc } = await seedWorld(sql)
			const ledger = new LedgerService(new LedgerRepository(sql))
			const personalLink = await seedLink(sql, {
				artifactId: personalDoc.artifact,
				revisionId: personalDoc.revision,
				createdBy: ada,
			})
			const teamLink = await seedLink(sql, {
				artifactId: teamDoc.artifact,
				revisionId: teamDoc.revision,
				createdBy: ada,
			})

			const call = (principal: Parameters<LedgerService["openCall"]>[0]["principal"]) =>
				ledger.openCall({ principal, surface: "link", action: "links.open" })
			expect(await stamp(sql, await call({ kind: "link", id: personalLink }))).toBe(personal)
			expect(await stamp(sql, await call({ kind: "link", id: teamLink }))).toBe(team)
			expect(await stamp(sql, await call(anonymousReader(personalDoc.artifact)))).toBe(personal)
			expect(await stamp(sql, await call(anonymousReader(teamDoc.artifact)))).toBe(team)
		}))

	it("is the account's home Workspace for the server operator", () =>
		withDb(async (sql) => {
			const { team, ada } = await seedWorld(sql)
			const callId = await new LedgerService(new LedgerRepository(sql)).openCall({
				principal: { kind: "operator", id: ada },
				surface: "operator",
				action: "workspaces.invite",
			})
			expect(await stamp(sql, callId)).toBe(team)
		}))

	it("is derived by the database for a writer that names none, and never replaces one it was given", () =>
		withDb(async (sql) => {
			const { team, ada, personal } = await seedWorld(sql)
			const insert = async (workspaceId: string | null) =>
				(
					await sql<{ workspaceId: string }[]>`
						INSERT INTO exagram.ledger_calls (principal_kind, principal_id, surface, action, workspace_id)
						VALUES ('user', ${ada}, 'web', 'artifacts.list', ${workspaceId}) RETURNING workspace_id AS "workspaceId"`
				)[0]!.workspaceId

			expect(await insert(null)).toBe(team)
			expect(await insert(personal)).toBe(personal)
		}))

	it("is the passed Workspace for a search", () =>
		withDb(async (sql) => {
			const { team, ada, personal, teamDoc, personalDoc } = await seedWorld(sql)
			const search = (workspaceId: string) =>
				new SearchRepository(sql).search({
					principalKind: "user",
					principalId: ada,
					surface: "web",
					workspaceId,
					query: "plan",
					limit: 20,
				})

			expect((await search(personal)).map((hit) => hit.artifactId)).toEqual([personalDoc.artifact])
			expect((await search(team)).map((hit) => hit.artifactId)).toEqual([teamDoc.artifact])

			const calls = await sql<{ workspaceId: string }[]>`
				SELECT workspace_id AS "workspaceId" FROM exagram.ledger_calls
				WHERE action = 'artifacts.search' ORDER BY started_at`
			expect(calls).toEqual([{ workspaceId: personal }, { workspaceId: team }])
		}))
})

describe("Audit placement of a Ledger call", () => {
	const refused = async (
		sql: Sql,
		principal: Parameters<ReturnType<typeof buildServeService>["resolve"]>[0]["principal"],
		action: string,
	) => {
		await expect(
			buildServeService(sql).resolve({
				principal,
				surface: "web",
				action,
				artifactId: randomUUID(),
				requireRevision: false,
			}),
		).rejects.toThrow()
		return (await callsOf(sql, action))[0]!
	}

	it("follows the stamp and the served Artifact, so a Personal session's reads stay out of the Team's Audit", () =>
		withDb(async (sql) => {
			const { team, ada, personal, teamDoc, personalDoc } = await seedWorld(sql)
			const serve = buildServeService(sql)
			const read = (workspaceId: string, artifactId: string, action: string) =>
				serve.resolve({
					principal: { kind: "user", id: ada, workspaceId },
					surface: "web",
					action,
					artifactId,
					requireRevision: true,
				})

			const personalReadOfPersonal = (await read(personal, personalDoc.artifact, "t.a")).callId
			const teamReadOfTeam = (await read(team, teamDoc.artifact, "t.b")).callId
			const personalReadOfTeam = (await read(personal, teamDoc.artifact, "t.c")).callId
			const personalProbe = await refused(sql, { kind: "user", id: ada, workspaceId: personal }, "t.d")

			expect(await auditOf(sql, team)).toEqual([teamReadOfTeam, personalReadOfTeam].sort())
			expect(await auditOf(sql, personal)).toEqual([personalReadOfPersonal, personalReadOfTeam, personalProbe].sort())
		}))

	it("keeps a read of a Personal Workspace's file out of a Team's Audit even when the session acts in the Team", () =>
		withDb(async (sql) => {
			const { team, ada, personal, personalDoc } = await seedWorld(sql)
			const { callId } = await buildServeService(sql).resolve({
				principal: { kind: "user", id: ada, workspaceId: team },
				surface: "web",
				action: "artifacts.get",
				artifactId: personalDoc.artifact,
				requireRevision: true,
			})

			expect(await stamp(sql, callId)).toBe(team)
			expect(await auditOf(sql, team)).toEqual([])
			expect(await auditOf(sql, personal)).toEqual([callId])
		}))

	it("shows a refused read of a Personal Workspace's file and of an id that exists nowhere alike", () =>
		withDb(async (sql) => {
			const { other, gus, personalDoc } = await seedWorld(sql)
			const ask = async (artifactId: string, action: string) => {
				await expect(
					buildServeService(sql).resolve({
						principal: { kind: "user", id: gus, workspaceId: other },
						surface: "web",
						action,
						artifactId,
						requireRevision: false,
					}),
				).rejects.toThrow()
				return (await callsOf(sql, action))[0]!
			}

			const ofPersonal = await ask(personalDoc.artifact, "t.personal")
			const ofNothing = await ask(randomUUID(), "t.nothing")

			expect(await auditOf(sql, other)).toEqual([ofPersonal, ofNothing].sort())
		}))

	it("shows a Guest's read of a Team's Artifact in the Team's Audit as well as the Workspace the Guest read from", () =>
		withDb(async (sql) => {
			const { team, teamDoc, other, gus, gusPersonal } = await seedWorld(sql)
			const { callId } = await buildServeService(sql).resolve({
				principal: { kind: "user", id: gus, workspaceId: gusPersonal },
				surface: "web",
				action: "artifacts.get",
				artifactId: teamDoc.artifact,
				requireRevision: true,
			})

			expect(await auditOf(sql, team)).toEqual([callId])
			expect(await auditOf(sql, gusPersonal)).toEqual([callId])
			expect(await auditOf(sql, other)).toEqual([])
		}))

	it("reads the stamp alone, so a call with none is in no Audit but its Artifact's", () =>
		withDb(async (sql) => {
			const { team, ada, personal, teamDoc } = await seedWorld(sql)
			const bound = await seedConnection(sql, { userId: ada })
			await sql`UPDATE exagram.connections SET workspace_id = ${personal} WHERE id = ${bound}`

			const byAda = await refused(sql, { kind: "user", id: ada, workspaceId: personal }, "t.ada")
			const byConnection = await refused(sql, { kind: "connection", id: bound }, "t.connection")
			const { callId: ofTeamDoc } = await buildServeService(sql).resolve({
				principal: { kind: "user", id: ada, workspaceId: personal },
				surface: "web",
				action: "t.read",
				artifactId: teamDoc.artifact,
				requireRevision: true,
			})
			expect(await auditOf(sql, personal)).toEqual([byAda, byConnection, ofTeamDoc].sort())

			await sql`UPDATE exagram.ledger_calls SET workspace_id = NULL`
			expect(await auditOf(sql, personal)).toEqual([])
			expect(await auditOf(sql, team)).toEqual([ofTeamDoc])
		}))
})
