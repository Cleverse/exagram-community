import { randomUUID } from "node:crypto"

import { MIN_ACCEPTED_DETECTOR_VERSION } from "@exagram/redactor"
import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import {
	seedArtifact,
	seedConnection,
	seedGrant,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
	approveRevision,
} from "../../test/seed"

import { ConnectionsRepository } from "./connections.repository"
import { McpRepository } from "./mcp.repository"

import type { Sql } from "postgres"

const ownerOf = async (sql: Sql, artifactId: string) =>
	(await sql<{ owner: string }[]>`SELECT "exagram"."artifact_owner"(${artifactId}::uuid) AS owner`)[0]!.owner

describe("McpRepository (integration)", () => {
	it("keeps folder settings on re-consent and starts at all after revoke", () =>
		withDb(async (sql) => {
			const workspaceId = await seedWorkspace(sql)
			const userId = await seedUser(sql, { workspaceId, email: "owner@example.com" })
			const projectId = await seedProject(sql, { workspaceId, ownerId: userId, name: "P" })
			const connections = new ConnectionsRepository(sql)
			const args = {
				userId,
				oidcClientId: "client",
				oidcGrantId: "grant-1",
				name: "Client",
				scopes: ["read"],
				workspaceId,
			}
			const first = (await connections.upsert(args))!
			await sql`UPDATE exagram.connections SET folder_access = 'named', other_files_access = 'view' WHERE id = ${first.id}::uuid`
			await sql`INSERT INTO exagram.connection_folders (connection_id, project_id, access) VALUES (${first.id}::uuid, ${projectId}::uuid, 'view')`

			const renewed = await connections.upsert({ ...args, oidcGrantId: "grant-2" })
			expect(renewed!.id).toBe(first.id)
			expect(await connections.getFolders(first.id, userId)).toEqual({
				access: "named",
				otherFilesAccess: "view",
				folders: [{ projectId, access: "view" }],
			})

			await connections.revoke(first.id, userId)
			const next = (await connections.upsert({ ...args, oidcGrantId: "grant-3" }))!
			expect(next.id).not.toBe(first.id)
			expect(await connections.getFolders(next.id, userId)).toEqual({
				access: "all",
				otherFilesAccess: "none",
				folders: [],
			})
		}))

	describe("listArtifacts / getArtifactForRead", () => {
		it("reaches every Artifact its person owns, across every Project", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const p = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				const q = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Q" })
				await sql`UPDATE "exagram"."projects" SET redaction = 'off' WHERE id IN (${p}, ${q})`

				const mk = async (projectId: string, title: string) => {
					const artifactId = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, projectId, title })
					const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: owner })
					await approveRevision(sql, artifactId, revisionId)
					return artifactId
				}
				const inP = await mk(p, "pricing in P")
				const inQ = await mk(q, "pricing in Q")

				const connection = await seedConnection(sql, { userId: owner })
				const repository = new McpRepository(sql)

				const listed = await repository.listArtifacts(connection, { limit: 50 })
				expect(listed.map((row) => row.id).sort()).toEqual([inP, inQ].sort())

				expect(await repository.getArtifactForRead(connection, inQ, { kind: "current" })).toMatchObject({
					id: inQ,
					seq: 1,
				})
			}))

		it("carries the stored body's sha256 and bytes only when the original body is what it serves", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const off = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Off" })
				const on = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "On" })
				await sql`UPDATE "exagram"."projects" SET redaction = 'off' WHERE id = ${off}`
				await sql`UPDATE "exagram"."projects" SET redaction = 'on' WHERE id = ${on}`

				const mk = async (projectId: string, title: string) => {
					const artifactId = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, projectId, title })
					const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: owner, bytes: 42 })
					await approveRevision(sql, artifactId, revisionId)
					return { artifactId, revisionId }
				}
				const plain = await mk(off, "original")
				const pending = await mk(on, "redaction not ready")
				const redacted = await mk(on, "redaction ready")
				await sql`
					UPDATE "exagram"."revisions"
					SET redaction_status = 'done', redacted_text = 'safe text', redaction_detector_version = ${MIN_ACCEPTED_DETECTOR_VERSION}
					WHERE id = ${redacted.revisionId}`

				const connection = await seedConnection(sql, { userId: owner })
				const repository = new McpRepository(sql)
				const read = (artifactId: string) => repository.getArtifactForRead(connection, artifactId, { kind: "current" })

				const plainRow = await read(plain.artifactId)
				expect(plainRow).toMatchObject({ sha256: "0".repeat(64) })
				expect(Number(plainRow!.bytes)).toBe(42)
				expect(await read(pending.artifactId)).toMatchObject({ redactedText: null, sha256: null, bytes: null })
				expect(await read(redacted.artifactId)).toMatchObject({
					redactedText: "safe text",
					sha256: null,
					bytes: null,
				})
			}))
	})

	describe("with redaction switched off", () => {
		const seedRedactedOnArtifact = async (sql: Sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, projectId: project, title: "Plan" })
			await sql`UPDATE "exagram"."artifacts" SET redaction = 'on' WHERE id = ${artifact}::uuid`
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)
			await sql`UPDATE "exagram"."revisions" SET extracted_text = 'zebra forecast for jane@example.com' WHERE id = ${revision}::uuid`
			const connection = await seedConnection(sql, { userId: owner })
			return { artifact, connection }
		}

		it("withholds an Artifact set to on that has no Redacted Text while enabled", () =>
			withDb(async (sql) => {
				const { artifact, connection } = await seedRedactedOnArtifact(sql)
				const repository = new McpRepository(sql)

				expect(await repository.listArtifacts(connection, { limit: 50 })).toEqual([])
				expect(await repository.searchArtifacts(connection, { query: "zebra", projectId: null, limit: 10 })).toEqual([])
				expect(await repository.getArtifactForRead(connection, artifact, { kind: "current" })).toMatchObject({
					redactionOn: true,
					ready: false,
					storageKey: null,
					extractedText: null,
				})
			}))

		it("reads the original, lists and searches it, though the stored setting stays on", () =>
			withDb(async (sql) => {
				const { artifact, connection } = await seedRedactedOnArtifact(sql)
				const repository = new McpRepository(sql, false)

				expect((await repository.listArtifacts(connection, { limit: 50 })).map((row) => row.id)).toEqual([artifact])

				const found = await repository.searchArtifacts(connection, { query: "zebra", projectId: null, limit: 10 })
				expect(found.map((row) => row.id)).toEqual([artifact])
				expect(found[0]!.snippet).toContain("jane@example.com")

				const read = await repository.getArtifactForRead(connection, artifact, { kind: "current" })
				expect(read).toMatchObject({ redactionOn: false, ready: true, redactedText: null })
				expect(read!.storageKey).not.toBeNull()
				expect(read!.sha256).not.toBeNull()
				expect(read!.bytes).not.toBeNull()
				expect(read!.extractedText).toBe("zebra forecast for jane@example.com")

				const [stored] = await sql<{ redaction: string }[]>`
					SELECT redaction FROM "exagram"."artifacts" WHERE id = ${artifact}::uuid`
				expect(stored!.redaction).toBe("on")
			}))
	})

	describe("findWritableArtifact", () => {
		it("lets an edit grantee add a Revision to a pending-only Artifact it created", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const editor = await seedUser(sql, { workspaceId: ws, email: "editor@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				await seedGrant(sql, { projectId: project, granteeId: editor, role: "edit", createdBy: owner })
				const connection = await seedConnection(sql, { userId: editor })

				const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: editor, projectId: project, title: "B" })
				await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: editor, authorConnectionId: connection })

				const repository = new McpRepository(sql)
				expect(await repository.findWritableArtifact(connection, artifact)).toEqual({ id: artifact, kind: "doc" })
			}))

		it("refuses a view grantee on the same pending-only Artifact", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const editor = await seedUser(sql, { workspaceId: ws, email: "editor@example.com" })
				const viewer = await seedUser(sql, { workspaceId: ws, email: "viewer@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				await seedGrant(sql, { projectId: project, granteeId: editor, role: "edit", createdBy: owner })
				await seedGrant(sql, { projectId: project, granteeId: viewer, role: "view", createdBy: owner })
				const editorConnection = await seedConnection(sql, { userId: editor })
				const viewerConnection = await seedConnection(sql, { userId: viewer })

				const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: editor, projectId: project, title: "B" })
				await seedRevision(sql, {
					artifactId: artifact,
					seq: 1,
					authorUserId: editor,
					authorConnectionId: editorConnection,
				})

				const repository = new McpRepository(sql)
				expect(await repository.findWritableArtifact(viewerConnection, artifact)).toBeNull()
			}))
	})

	describe("findWritableArtifact precedence", () => {
		it("decides on the row visible_artifacts picks: a direct view Grant outranks a Project edit Grant", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const person = await seedUser(sql, { workspaceId: ws, email: "person@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, projectId: project, title: "A" })
				const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
				await approveRevision(sql, artifact, revision)
				await seedGrant(sql, { projectId: project, granteeId: person, role: "edit", createdBy: owner })
				const connection = await seedConnection(sql, { userId: person })
				const repository = new McpRepository(sql)

				expect(await repository.findWritableArtifact(connection, artifact)).toEqual({ id: artifact, kind: "doc" })
				await seedGrant(sql, { artifactId: artifact, granteeId: person, role: "view", createdBy: owner })
				expect(await repository.findWritableArtifact(connection, artifact)).toBeNull()
			}))

		it("lets a Collaborator's Connection add a Revision", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const person = await seedUser(sql, { workspaceId: ws, email: "person@example.com" })
				const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
				const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
				await approveRevision(sql, artifact, revision)
				await seedGrant(sql, { artifactId: artifact, granteeId: person, role: "collaborate", createdBy: owner })
				const connection = await seedConnection(sql, { userId: person })

				expect(await new McpRepository(sql).findWritableArtifact(connection, artifact)).toEqual({
					id: artifact,
					kind: "doc",
				})
			}))
	})

	describe("insertArtifact", () => {
		it("refuses a Project the person only holds a view Grant on", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				await seedGrant(sql, { projectId: project, granteeId: grantee, role: "view", createdBy: owner })
				const connection = await seedConnection(sql, { userId: grantee })

				const repository = new McpRepository(sql)
				expect(
					await repository.insertArtifact({ connectionId: connection, projectId: project, kind: "doc", title: "x" }),
				).toBeNull()
			}))

		it("creates the Artifact under the Project Owner when the person holds an edit Grant", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				await seedGrant(sql, { projectId: project, granteeId: grantee, role: "edit", createdBy: owner })
				const connection = await seedConnection(sql, { userId: grantee })

				const repository = new McpRepository(sql)
				const created = await repository.insertArtifact({
					connectionId: connection,
					projectId: project,
					kind: "doc",
					title: "x",
				})
				expect(created).not.toBeNull()
				expect(await ownerOf(sql, created!.id)).toBe(owner)
			}))

		it("creates the Artifact in a child of a Project the person holds an edit Grant on", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
				const parent = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				const child = await seedProject(sql, {
					workspaceId: ws,
					ownerId: owner,
					name: "C",
					parentProjectId: parent,
				})
				await seedGrant(sql, { projectId: parent, granteeId: grantee, role: "edit", createdBy: owner })
				const connection = await seedConnection(sql, { userId: grantee })

				const repository = new McpRepository(sql)
				const created = await repository.insertArtifact({
					connectionId: connection,
					projectId: child,
					kind: "doc",
					title: "x",
				})
				expect(created).not.toBeNull()
			}))

		it("refuses a Project the person cannot reach at all", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const stranger = await seedUser(sql, { workspaceId: ws, email: "stranger@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				const connection = await seedConnection(sql, { userId: stranger })

				const repository = new McpRepository(sql)
				expect(
					await repository.insertArtifact({ connectionId: connection, projectId: project, kind: "doc", title: "x" }),
				).toBeNull()
			}))
	})

	describe("removeGrant / updateGrantRole", () => {
		it("lets the Project Owner's Connection manage a Grant on an Artifact somebody else authored inside it", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const author = await seedUser(sql, { workspaceId: ws, email: "author@example.com" })
				const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				const artifact = await seedArtifact(sql, {
					workspaceId: ws,
					ownerId: author,
					projectId: project,
					title: "A",
				})
				const grant = await seedGrant(sql, { artifactId: artifact, granteeId: grantee, role: "view", createdBy: owner })
				const connection = await seedConnection(sql, { userId: owner })

				const repository = new McpRepository(sql)
				expect(await repository.removeGrant(connection, grant)).toEqual({ id: grant, artifactId: artifact })
			}))

		it("refuses an edit grantee's Connection: manage is Owner-only, and the Grant row is untouched", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const editor = await seedUser(sql, { workspaceId: ws, email: "editor@example.com" })
				const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
				const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
				await seedGrant(sql, { artifactId: artifact, granteeId: editor, role: "edit", createdBy: owner })
				const grant = await seedGrant(sql, { artifactId: artifact, granteeId: grantee, role: "view", createdBy: owner })
				const connection = await seedConnection(sql, { userId: editor })

				const repository = new McpRepository(sql)
				expect(await repository.removeGrant(connection, grant)).toBeNull()

				const [row] = await sql<{ id: string }[]>`SELECT "id" FROM "exagram"."grants" WHERE "id" = ${grant}`
				expect(row).toBeDefined()
			}))

		it("refuses the former Owner's Connection once the Artifact moved into another Owner's Project", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const stranger = await seedUser(sql, { workspaceId: ws, email: "stranger@example.com" })
				const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
				const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "A" })
				const grant = await seedGrant(sql, { artifactId: artifact, granteeId: grantee, role: "view", createdBy: owner })
				const otherProject = await seedProject(sql, { workspaceId: ws, ownerId: stranger, name: "Q" })
				await sql`UPDATE "exagram"."artifacts" SET "project_id" = ${otherProject} WHERE "id" = ${artifact}`
				const connection = await seedConnection(sql, { userId: owner })

				const repository = new McpRepository(sql)
				expect(await repository.removeGrant(connection, grant)).toBeNull()

				const [row] = await sql<{ id: string }[]>`SELECT "id" FROM "exagram"."grants" WHERE "id" = ${grant}`
				expect(row).toBeDefined()
			}))
	})

	describe("listProjects", () => {
		it("lists owned, Project-granted, and child-of-granted Projects, and nothing else", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const person = await seedUser(sql, { workspaceId: ws, email: "person@example.com" })
				const stranger = await seedUser(sql, { workspaceId: ws, email: "stranger@example.com" })

				const owned = await seedProject(sql, { workspaceId: ws, ownerId: person, name: "Owned" })
				const grantedParent = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Granted" })
				const grantedChild = await seedProject(sql, {
					workspaceId: ws,
					ownerId: owner,
					name: "Child",
					parentProjectId: grantedParent,
				})
				await seedProject(sql, { workspaceId: ws, ownerId: stranger, name: "Unreachable" })
				await seedGrant(sql, { projectId: grantedParent, granteeId: person, role: "edit", createdBy: owner })

				const connection = await seedConnection(sql, { userId: person })
				const repository = new McpRepository(sql)
				const rows = await repository.listProjects(connection)

				expect(rows.map((r) => r.id).sort()).toEqual([owned, grantedParent, grantedChild].sort())
				expect(rows.find((r) => r.id === owned)?.access).toBe("owner")
				expect(rows.find((r) => r.id === grantedParent)?.access).toBe("edit")
				expect(rows.find((r) => r.id === grantedChild)?.access).toBe("edit")
			}))
	})

	describe("named folder enforcement", () => {
		it("caps project access and hides a parent outside the folder set", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const person = await seedUser(sql, { workspaceId: ws, email: "person@example.com" })
				const parent = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "Parent" })
				const child = await seedProject(sql, {
					workspaceId: ws,
					ownerId: owner,
					name: "Child",
					parentProjectId: parent,
				})
				await seedGrant(sql, { projectId: child, granteeId: person, role: "edit", createdBy: owner })
				const connection = await seedConnection(sql, { userId: person })
				await sql`UPDATE "exagram"."connections" SET "folder_access" = 'named' WHERE "id" = ${connection}`
				await sql`INSERT INTO "exagram"."connection_folders" ("connection_id", "project_id", "access")
					VALUES (${connection}, ${child}, 'view')`

				const repository = new McpRepository(sql)
				expect(await repository.listProjects(connection)).toMatchObject([
					{ id: child, parentProjectId: null, access: "view" },
				])
				expect(
					await repository.insertArtifact({ connectionId: connection, projectId: child, kind: "doc", title: "A" }),
				).toBeNull()
			}))

		it("rechecks the folder right when inserting a Revision", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, projectId: project, title: "A" })
				const connection = await seedConnection(sql, { userId: owner })
				await sql`UPDATE "exagram"."connections" SET "folder_access" = 'named' WHERE "id" = ${connection}`
				await sql`INSERT INTO "exagram"."connection_folders" ("connection_id", "project_id", "access")
					VALUES (${connection}, ${project}, 'edit')`

				const repository = new McpRepository(sql)
				expect(await repository.findWritableArtifact(connection, artifact)).toEqual({ id: artifact, kind: "doc" })
				await sql`UPDATE "exagram"."connection_folders" SET "access" = 'view'
					WHERE "connection_id" = ${connection} AND "project_id" = ${project}`
				expect(
					await repository.insertRevision({
						connectionId: connection,
						artifactId: artifact,
						storageKey: `artifacts/${artifact}/1`,
						mime: "text/markdown",
						bytes: 12,
						sha256: "0".repeat(64),
						note: null,
					}),
				).toBeNull()
				const [row] = await sql<{ count: number }[]>`
					SELECT count(*)::int AS count FROM "exagram"."revisions" WHERE "artifact_id" = ${artifact}
				`
				expect(row!.count).toBe(0)
			}))

		it("classifies view-folder write refusals without classifying missing ids as folder exclusions", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, projectId: project, title: "A" })
				const grant = await seedGrant(sql, { artifactId: artifact, granteeId: grantee, role: "view", createdBy: owner })
				const connection = await seedConnection(sql, { userId: owner })
				await sql`UPDATE "exagram"."connections" SET "folder_access" = 'named' WHERE "id" = ${connection}`
				await sql`INSERT INTO "exagram"."connection_folders" ("connection_id", "project_id", "access")
					VALUES (${connection}, ${project}, 'view')`

				const repository = new McpRepository(sql)
				expect(await repository.classifyNewArtifactRefusal(connection, project)).toBe("outside-connection-folders")
				expect(await repository.classifyRevisionRefusal(connection, artifact)).toBe("outside-connection-folders")
				expect(await repository.classifyGrantRefusal(connection, grant)).toBe("outside-connection-folders")
				expect(await repository.classifyReadRefusal(connection, artifact)).toBe("out-of-boundary")
				expect(await repository.classifyReadRefusal(connection, randomUUID())).toBe("out-of-boundary")
				expect(await repository.classifyGrantRefusal(connection, randomUUID())).toBe("out-of-boundary")
			}))

		it("distinguishes a pending Revision outside folders from a missing Current Revision inside one", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
				const editor = await seedUser(sql, { workspaceId: ws, email: "editor@example.com" })
				const project = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
				await seedGrant(sql, { projectId: project, granteeId: editor, role: "edit", createdBy: owner })
				const connection = await seedConnection(sql, { userId: editor })
				const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, projectId: project, title: "A" })
				await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: editor, authorConnectionId: connection })
				await sql`UPDATE "exagram"."connections" SET "folder_access" = 'named' WHERE "id" = ${connection}`

				const repository = new McpRepository(sql)
				expect(await repository.classifyReadRefusal(connection, artifact)).toBe("outside-connection-folders")
				await sql`INSERT INTO "exagram"."connection_folders" ("connection_id", "project_id", "access")
					VALUES (${connection}, ${project}, 'view')`
				expect(await repository.classifyReadRefusal(connection, artifact)).toBe("out-of-boundary")
			}))
	})
})
