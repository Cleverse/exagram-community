import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedGrant,
	seedMembership,
	seedPersonalWorkspace,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "../../test/seed"

import { ConnectionsRepository } from "./connections.repository"

import type { Sql } from "postgres"

const ids = (rows: { artifact_id: string }[]) => rows.map((row) => row.artifact_id).sort()

const visible = async (sql: Sql, kind: "user" | "connection", id: string) =>
	ids(
		await sql<{ artifact_id: string }[]>`SELECT artifact_id FROM exagram.visible_artifacts(${kind}::text, ${id}::uuid)`,
	)

const readableRevisionArtifacts = async (sql: Sql, connectionId: string) => [
	...new Set(
		(
			await sql<{ artifact_id: string }[]>`
				SELECT artifact_id FROM exagram.connection_readable_revisions(${connectionId}::uuid)`
		).map((row) => row.artifact_id),
	),
]

const covers = async (sql: Sql, connectionId: string, workspaceId: string) =>
	(
		await sql<{ covered: boolean }[]>`
			SELECT exagram.connection_covers_workspace(${connectionId}::uuid, ${workspaceId}::uuid) AS covered`
	)[0]!.covered

const artifactRight = async (sql: Sql, connectionId: string, artifactId: string) =>
	(
		await sql<{ right: string | null }[]>`
			SELECT exagram.connection_artifact_right(${connectionId}::uuid, ${artifactId}::uuid) AS right`
	)[0]!.right

const projectRight = async (sql: Sql, connectionId: string, projectId: string) =>
	(
		await sql<{ right: string | null }[]>`
			SELECT exagram.connection_project_right(${connectionId}::uuid, ${projectId}::uuid) AS right`
	)[0]!.right

const canWrite = async (sql: Sql, connectionId: string, artifactId: string) =>
	(
		await sql<{ ok: boolean }[]>`
			SELECT exagram.connection_can_write_artifact(${connectionId}::uuid, ${artifactId}::uuid) AS ok`
	)[0]!.ok

async function world(sql: Sql) {
	const team = await seedWorkspace(sql, "Team")
	const elsewhere = await seedWorkspace(sql, "Elsewhere")
	const pat = await seedUser(sql, { workspaceId: team, email: "pat@team.test" })
	const personal = await seedPersonalWorkspace(sql, pat)
	const colleague = await seedUser(sql, { workspaceId: team, email: "colleague@team.test" })
	const stranger = await seedUser(sql, { workspaceId: elsewhere, email: "stranger@elsewhere.test" })

	const published = async (workspaceId: string, ownerId: string, title: string, projectId?: string) => {
		const artifactId = await seedArtifact(sql, { workspaceId, ownerId, title, projectId })
		const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
		await approveRevision(sql, artifactId, revisionId)
		return artifactId
	}

	const teamOwn = await published(team, pat, "Team own")
	const teamShared = await published(team, colleague, "Team shared")
	await seedGrant(sql, { granteeId: pat, createdBy: colleague, role: "edit", artifactId: teamShared })
	const teamFolder = await seedProject(sql, { workspaceId: team, ownerId: pat, name: "Team folder" })
	const inTeamFolder = await published(team, pat, "In Team folder", teamFolder)
	const personalOwn = await published(personal, pat, "Personal own")
	const personalFolder = await seedProject(sql, { workspaceId: personal, ownerId: pat, name: "Personal folder" })
	const outside = await published(elsewhere, stranger, "Outside")
	await seedGrant(sql, { granteeId: pat, createdBy: stranger, role: "edit", artifactId: outside })
	const outsideFolder = await seedProject(sql, { workspaceId: elsewhere, ownerId: stranger, name: "Outside folder" })
	const inOutsideFolder = await published(elsewhere, stranger, "In outside folder", outsideFolder)
	await seedGrant(sql, { granteeId: pat, createdBy: stranger, role: "edit", projectId: outsideFolder })

	return {
		team,
		personal,
		elsewhere,
		pat,
		colleague,
		stranger,
		teamOwn,
		teamShared,
		teamFolder,
		inTeamFolder,
		personalOwn,
		personalFolder,
		outside,
		outsideFolder,
		inOutsideFolder,
		teamConnection: await seedConnection(sql, { userId: pat, workspaceId: team }),
		personalConnection: await seedConnection(sql, { userId: pat, workspaceId: personal }),
	}
}

describe("a Connection's Workspace", () => {
	it("a Team-bound Connection reaches the Team's files and nothing else its person reaches", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			expect(await visible(sql, "connection", w.teamConnection)).toEqual(
				[w.teamOwn, w.teamShared, w.inTeamFolder].sort(),
			)
			expect(await visible(sql, "user", w.pat)).toEqual(
				[w.teamOwn, w.teamShared, w.inTeamFolder, w.personalOwn, w.outside, w.inOutsideFolder].sort(),
			)
		}))

	it("a Personal-bound Connection reaches the Personal's files and what Workspaces its person is outside of share", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			expect(await visible(sql, "connection", w.personalConnection)).toEqual(
				[w.personalOwn, w.outside, w.inOutsideFolder].sort(),
			)
		}))

	it.each([
		["live", ""],
		["removed", "removed_at = now()"],
		["invited", "invited_at = now()"],
	])(
		"the list and the rights agree with connection_covers_workspace while its person's Team membership is %s",
		(_state, set) =>
			withDb(async (sql) => {
				const w = await world(sql)
				if (set !== "")
					await sql.unsafe(`UPDATE exagram.memberships SET ${set} WHERE user_id = $1 AND workspace_id = $2`, [
						w.pat,
						w.team,
					])
				const projects = await sql<
					{ id: string; workspace_id: string }[]
				>`SELECT id, workspace_id FROM exagram.projects`
				expect(projects).toHaveLength(3)
				for (const connection of [w.teamConnection, w.personalConnection]) {
					for (const project of projects) {
						expect
							.soft((await projectRight(sql, connection, project.id)) !== null, `project ${connection} ${project.id}`)
							.toBe(await covers(sql, connection, project.workspace_id))
					}
				}
				const files = await sql<{ id: string; workspace_id: string }[]>`SELECT id, workspace_id FROM exagram.artifacts`
				expect(files).toHaveLength(6)
				for (const connection of [w.teamConnection, w.personalConnection]) {
					const listed = new Set(await visible(sql, "connection", connection))
					for (const file of files) {
						const covered = await covers(sql, connection, file.workspace_id)
						expect.soft(listed.has(file.id), `listed ${connection} ${file.id}`).toBe(covered)
						expect
							.soft((await artifactRight(sql, connection, file.id)) !== null, `right ${connection} ${file.id}`)
							.toBe(covered)
					}
				}
			}),
	)

	it("every right the Connection holds follows its binding", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const team = w.teamConnection
			expect(await artifactRight(sql, team, w.teamOwn)).toBe("edit")
			expect(await artifactRight(sql, team, w.personalOwn)).toBeNull()
			expect(await artifactRight(sql, team, w.outside)).toBeNull()
			expect(await projectRight(sql, team, w.teamFolder)).toBe("edit")
			expect(await projectRight(sql, team, w.personalFolder)).toBeNull()
			expect(await projectRight(sql, team, w.outsideFolder)).toBeNull()
			expect(await canWrite(sql, team, w.teamOwn)).toBe(true)
			expect(await canWrite(sql, team, w.personalOwn)).toBe(false)
			expect(await canWrite(sql, team, w.outside)).toBe(false)
			expect(await readableRevisionArtifacts(sql, team)).toEqual(
				expect.arrayContaining([w.teamOwn, w.teamShared, w.inTeamFolder]),
			)
			expect(await readableRevisionArtifacts(sql, team)).toHaveLength(3)

			const personal = w.personalConnection
			expect(await artifactRight(sql, personal, w.personalOwn)).toBe("edit")
			expect(await artifactRight(sql, personal, w.outside)).toBe("edit")
			expect(await artifactRight(sql, personal, w.teamOwn)).toBeNull()
			expect(await artifactRight(sql, personal, w.teamShared)).toBeNull()
			expect(await projectRight(sql, personal, w.personalFolder)).toBe("edit")
			expect(await projectRight(sql, personal, w.outsideFolder)).toBe("edit")
			expect(await projectRight(sql, personal, w.teamFolder)).toBeNull()
			expect(await canWrite(sql, personal, w.outside)).toBe(true)
			expect(await canWrite(sql, personal, w.teamOwn)).toBe(false)
			expect(await canWrite(sql, personal, w.teamShared)).toBe(false)
			expect((await readableRevisionArtifacts(sql, personal)).sort()).toEqual(
				[w.personalOwn, w.outside, w.inOutsideFolder].sort(),
			)
		}))

	it("covers its own Workspace, and a Personal one also covers every Workspace its person is not a live member of", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			expect(await covers(sql, w.teamConnection, w.team)).toBe(true)
			expect(await covers(sql, w.teamConnection, w.personal)).toBe(false)
			expect(await covers(sql, w.teamConnection, w.elsewhere)).toBe(false)
			expect(await covers(sql, w.teamConnection, randomUUID())).toBe(false)
			expect(await covers(sql, w.personalConnection, w.personal)).toBe(true)
			expect(await covers(sql, w.personalConnection, w.elsewhere)).toBe(true)
			expect(await covers(sql, w.personalConnection, w.team)).toBe(false)
			expect(await covers(sql, randomUUID(), w.team)).toBe(false)
			const [nothing] = await sql<{ covered: boolean }[]>`
				SELECT exagram.connection_covers_workspace(${w.personalConnection}::uuid, NULL) AS covered`
			expect(nothing!.covered).toBe(false)
		}))

	it("a Workspace the person has left is outside the Team-bound reach and inside the Personal-bound one", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${w.pat} AND workspace_id = ${w.team}`
			expect(await covers(sql, w.teamConnection, w.team)).toBe(false)
			expect(await visible(sql, "connection", w.teamConnection)).toEqual([])
			expect(await artifactRight(sql, w.teamConnection, w.teamOwn)).toBeNull()
			expect(await readableRevisionArtifacts(sql, w.teamConnection)).toEqual([])
			expect(await covers(sql, w.personalConnection, w.team)).toBe(true)
		}))

	it("a revoked Connection and one whose person has no live membership of its Workspace reach nothing", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			await sql`UPDATE exagram.connections SET revoked_at = now() WHERE id = ${w.personalConnection}`
			expect(await visible(sql, "connection", w.personalConnection)).toEqual([])
			expect(await covers(sql, w.personalConnection, w.personal)).toBe(false)
			await seedMembership(sql, { userId: w.pat, workspaceId: w.personal, invited: true })
			expect(await covers(sql, w.teamConnection, w.team)).toBe(true)
			const invitedOnly = await seedConnection(sql, { userId: w.pat, workspaceId: w.personal })
			expect(await covers(sql, invitedOnly, w.personal)).toBe(false)
		}))

	it("Folder Access narrows inside the bound Team, and Other files never reach past its Workspace", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			await sql`UPDATE exagram.connections SET folder_access = 'named', other_files_access = 'view'
				WHERE id = ${w.teamConnection}`
			await sql`INSERT INTO exagram.connection_folders (connection_id, project_id, access)
				VALUES (${w.teamConnection}, ${w.teamFolder}, 'view')`
			expect(await visible(sql, "connection", w.teamConnection)).toEqual(
				[w.inTeamFolder, w.teamOwn, w.teamShared].sort(),
			)
			expect(await artifactRight(sql, w.teamConnection, w.inTeamFolder)).toBe("view")
			expect(await artifactRight(sql, w.teamConnection, w.outside)).toBeNull()
			expect(await artifactRight(sql, w.teamConnection, w.personalOwn)).toBeNull()

			await sql`UPDATE exagram.connections SET other_files_access = 'none' WHERE id = ${w.teamConnection}`
			expect(await visible(sql, "connection", w.teamConnection)).toEqual([w.inTeamFolder])
			expect(await artifactRight(sql, w.teamConnection, w.teamOwn)).toBeNull()
		}))

	it("moving a Connection to another Workspace drops the folders it named and keeps its Folder Access", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			await sql`UPDATE exagram.connections SET folder_access = 'named', other_files_access = 'view'
				WHERE id = ${w.teamConnection}`
			await sql`INSERT INTO exagram.connection_folders (connection_id, project_id, access)
				VALUES (${w.teamConnection}, ${w.teamFolder}, 'edit')`

			await sql`UPDATE exagram.connections SET name = 'Renamed' WHERE id = ${w.teamConnection}`
			expect(
				await sql`SELECT 1 FROM exagram.connection_folders WHERE connection_id = ${w.teamConnection}`,
			).toHaveLength(1)

			await sql`UPDATE exagram.connections SET workspace_id = ${w.personal} WHERE id = ${w.teamConnection}`
			expect(await sql`SELECT 1 FROM exagram.connection_folders WHERE connection_id = ${w.teamConnection}`).toEqual([])
			expect(
				await sql`SELECT folder_access, other_files_access FROM exagram.connections WHERE id = ${w.teamConnection}`,
			).toEqual([{ folder_access: "named", other_files_access: "view" }])
			expect(await visible(sql, "connection", w.teamConnection)).toEqual([w.personalOwn, w.outside].sort())
		}))
})

describe("ConnectionsRepository and a Connection's Workspace", () => {
	const consent = (
		userId: string,
		workspaceId: string,
		over: Partial<{ oidcGrantId: string; scopes: string[] }> = {},
	) => ({
		userId,
		oidcClientId: "claude",
		oidcGrantId: "grant-1",
		name: "Claude",
		scopes: ["read"],
		workspaceId,
		...over,
	})

	it("binds a Connection to the Workspace named, and re-consent moves the one live Connection", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const repo = new ConnectionsRepository(sql)
			await sql`DELETE FROM exagram.connections`
			const first = await repo.upsert(consent(w.pat, w.team))
			expect(first).toMatchObject({ workspaceId: w.team })
			const moved = await repo.upsert(consent(w.pat, w.personal, { oidcGrantId: "grant-2" }))
			expect(moved).toMatchObject({ id: first!.id, workspaceId: w.personal, oidcGrantId: "grant-2" })
			expect(await sql`SELECT workspace_id FROM exagram.connections`).toEqual([{ workspace_id: w.personal }])
		}))

	it("writes nothing when the person is not a live member of the Workspace, whether it exists or not", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const repo = new ConnectionsRepository(sql)
			await sql`DELETE FROM exagram.connections`
			expect(await repo.upsert(consent(w.pat, w.elsewhere))).toBeNull()
			expect(await repo.upsert(consent(w.pat, randomUUID()))).toBeNull()
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${w.pat} AND workspace_id = ${w.team}`
			expect(await repo.upsert(consent(w.pat, w.team))).toBeNull()
			expect(await sql`SELECT 1 FROM exagram.connections`).toEqual([])
		}))

	it("a refused move leaves the live Connection where it was", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const repo = new ConnectionsRepository(sql)
			await sql`DELETE FROM exagram.connections`
			await repo.upsert(consent(w.pat, w.team))
			expect(await repo.upsert(consent(w.pat, w.elsewhere, { oidcGrantId: "grant-2" }))).toBeNull()
			expect(await sql`SELECT workspace_id, oidc_grant_id FROM exagram.connections`).toEqual([
				{ workspace_id: w.team, oidc_grant_id: "grant-1" },
			])
		}))

	it("lists the Workspaces a person may bind to, Personal first, and no Workspace they have left", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const repo = new ConnectionsRepository(sql)
			expect(await repo.listConsentWorkspaces(w.pat)).toEqual([
				{ id: w.personal, kind: "personal", name: "Personal" },
				{ id: w.team, kind: "team", name: "Team" },
			])
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${w.pat} AND workspace_id = ${w.team}`
			expect(await repo.listConsentWorkspaces(w.pat)).toEqual([{ id: w.personal, kind: "personal", name: "Personal" }])
			expect(await repo.listConsentWorkspaces(randomUUID())).toEqual([])
		}))

	it("offers the folder picker only the Projects the Connection's binding covers", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const repo = new ConnectionsRepository(sql)
			const names = async (connectionId: string) =>
				(await repo.listReachableProjects(connectionId, w.pat)).map((project) => project.name).sort()
			expect(await names(w.teamConnection)).toEqual(["Team folder"])
			expect(await names(w.personalConnection)).toEqual(["Outside folder", "Personal folder"])
			const someoneElse = await seedUser(sql, { workspaceId: w.team, email: "else@team.test" })
			expect(await repo.listReachableProjects(w.teamConnection, someoneElse)).toEqual([])
		}))

	it("names a folder only inside the binding, whatever the picker checked first", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const repo = new ConnectionsRepository(sql)
			const save = (projectId: string) =>
				repo.replaceFolders({
					connectionId: w.teamConnection,
					userId: w.pat,
					access: "named",
					otherFilesAccess: "none",
					folders: [{ projectId, access: "view" }],
				})
			await expect(save(w.personalFolder)).rejects.toThrow("invalid connection folders")
			await expect(save(w.outsideFolder)).rejects.toThrow("invalid connection folders")
			await expect(save(randomUUID())).rejects.toThrow("invalid connection folders")
			expect(await save(w.teamFolder)).toBe(true)
			expect(await sql`SELECT project_id FROM exagram.connection_folders`).toEqual([{ project_id: w.teamFolder }])
		}))

	it("shows and counts only the folders the binding covers, so a leftover one cannot block a save", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const repo = new ConnectionsRepository(sql)
			await sql`UPDATE exagram.connections SET folder_access = 'named' WHERE id = ${w.teamConnection}`
			await sql`INSERT INTO exagram.connection_folders (connection_id, project_id, access)
				VALUES (${w.teamConnection}, ${w.teamFolder}, 'view'), (${w.teamConnection}, ${w.outsideFolder}, 'view')`

			expect(await repo.getFolders(w.teamConnection, w.pat)).toMatchObject({
				folders: [{ projectId: w.teamFolder, access: "view" }],
			})
			const counted = (await repo.listByUser(w.pat)).find((row) => row.id === w.teamConnection)
			expect(counted?.folderCount).toBe(1)

			expect(
				await repo.replaceFolders({
					connectionId: w.teamConnection,
					userId: w.pat,
					access: "named",
					otherFilesAccess: "none",
					folders: [{ projectId: w.teamFolder, access: "edit" }],
				}),
			).toBe(true)
			expect(await sql`SELECT project_id FROM exagram.connection_folders`).toEqual([{ project_id: w.teamFolder }])
		}))

	it("lists each Connection with the Workspace it is bound to", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const rows = await new ConnectionsRepository(sql).listByUser(w.pat)
			expect(Object.fromEntries(rows.map((row) => [row.id, row.workspaceId]))).toEqual({
				[w.teamConnection]: w.team,
				[w.personalConnection]: w.personal,
			})
		}))

	it("lists only the Connections bound to the Workspace it is asked for", () =>
		withDb(async (sql) => {
			const w = await world(sql)
			const repo = new ConnectionsRepository(sql)
			const colleagueConnection = await seedConnection(sql, { userId: w.colleague, workspaceId: w.team })
			const idsIn = async (workspaceId: string) => (await repo.listByUser(w.pat, workspaceId)).map((row) => row.id)

			expect(await idsIn(w.team)).toEqual([w.teamConnection])
			expect(await idsIn(w.personal)).toEqual([w.personalConnection])
			expect(await idsIn(w.elsewhere)).toEqual([])
			expect((await repo.listByUser(w.pat)).map((row) => row.id).sort()).toEqual(
				[w.teamConnection, w.personalConnection].sort(),
			)
			expect((await repo.listByUser(w.colleague, w.team)).map((row) => row.id)).toEqual([colleagueConnection])
		}))
})
