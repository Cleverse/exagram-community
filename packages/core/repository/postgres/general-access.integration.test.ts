import { describe, expect, it } from "vitest"

import { setRemoved } from "../../test/membership-state"
import { withDb } from "../../test/pg"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedGrant,
	seedLink,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "../../test/seed"

import { ArtifactsRepository } from "./artifacts.repository"
import { McpRepository } from "./mcp.repository"
import { SearchRepository } from "./search.repository"

import type { Sql } from "postgres"

type Row = {
	artifact_id: string
	revision_id: string
	access: string
	pinned: boolean
	org_only: boolean
	download: boolean
}

const read = (sql: Sql, kind: string, id: string, artifactId: string) =>
	sql<Row[]>`SELECT * FROM exagram.visible_artifact(${kind}, ${id}::uuid, ${artifactId}::uuid)`

describe("visible_artifact general access (integration)", () => {
	it("opens an org file by id for a matching Google identity without enumerating it", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const reader = await seedUser(sql, { workspaceId: ws, email: "password@elsewhere.test" })
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${ws}, 'acme.test')`
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${reader}, 'google', 'reader-google', 'reader@acme.test')`
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Org plan" })
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)
			await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${artifact}`

			expect(await read(sql, "user", reader, artifact)).toEqual([
				{
					artifact_id: artifact,
					revision_id: revision,
					access: "view",
					pinned: false,
					org_only: true,
					download: true,
				},
			])
			expect(await sql`SELECT * FROM exagram.visible_artifacts('user', ${reader}::uuid)`).toEqual([])
			const artifacts = new ArtifactsRepository(sql)
			expect(await artifacts.listVisible({ kind: "user", id: reader }, { workspaceId: ws, scope: "all" })).toEqual([])
			expect(
				await new SearchRepository(sql).search({
					principalKind: "user",
					principalId: reader,
					surface: "web",
					workspaceId: ws,
					query: "Org plan",
					limit: 20,
				}),
			).toEqual([])
			const connection = await seedConnection(sql, { userId: reader })
			expect(await read(sql, "connection", connection, artifact)).toEqual([])
			const mcp = new McpRepository(sql)
			expect(await mcp.listArtifacts(connection, { limit: 20 })).toEqual([])
			expect(await mcp.searchArtifacts(connection, { query: "Org plan", projectId: null, limit: 20 })).toEqual([])
		}))

	it("requires a matching Google identity, workspace domain and current revision", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const otherWs = await seedWorkspace(sql, "Other")
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const password = await seedUser(sql, { workspaceId: ws, email: "password@acme.test" })
			const matchingGoogle = await seedUser(sql, { workspaceId: ws, email: "matching@example.com" })
			const wrongDomain = await seedUser(sql, { workspaceId: ws, email: "wrong@example.com" })
			const outsider = await seedUser(sql, { workspaceId: otherWs, email: "outsider@example.com" })
			for (const [userId, subject, email] of [
				[matchingGoogle, "matching", "matching@acme.test"],
				[wrongDomain, "wrong", "wrong@other.test"],
				[outsider, "outsider", "outsider@acme.test"],
			] as const) {
				await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
					VALUES (${userId}, 'google', ${subject}, ${email})`
			}
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Org" })
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)
			await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${artifact}`
			for (const userId of [password, matchingGoogle, wrongDomain, outsider]) {
				expect(await read(sql, "user", userId, artifact)).toEqual([])
			}
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${ws}, 'acme.test')`
			for (const userId of [password, wrongDomain, outsider]) {
				expect(await read(sql, "user", userId, artifact)).toEqual([])
			}
			expect(await read(sql, "user", matchingGoogle, artifact)).toHaveLength(1)
			await sql`UPDATE exagram.artifacts SET general_access = 'restricted' WHERE id = ${artifact}`
			expect(await read(sql, "user", matchingGoogle, artifact)).toEqual([])
			await sql`UPDATE exagram.artifacts SET general_access = 'org', current_revision_id = NULL WHERE id = ${artifact}`
			expect(await read(sql, "user", matchingGoogle, artifact)).toEqual([])
			await sql`UPDATE exagram.artifacts SET current_revision_id = ${revision}, deleted_at = now() WHERE id = ${artifact}`
			expect(await read(sql, "user", matchingGoogle, artifact)).toEqual([])
		}))

	it("keeps owner access and a pinned grant ahead of the org tier", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const reader = await seedUser(sql, { workspaceId: ws, email: "reader@example.com" })
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${ws}, 'acme.test')`
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${reader}, 'google', 'reader', 'reader@acme.test')`
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Org" })
			const first = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, first)
			const current = await seedRevision(sql, { artifactId: artifact, seq: 2, authorUserId: owner })
			await approveRevision(sql, artifact, current)
			await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${artifact}`
			await seedGrant(sql, {
				artifactId: artifact,
				granteeId: reader,
				role: "view",
				pinnedRevisionId: first,
				createdBy: owner,
			})
			expect(await read(sql, "user", reader, artifact)).toEqual([
				{
					artifact_id: artifact,
					revision_id: first,
					access: "view",
					pinned: true,
					org_only: false,
					download: true,
				},
			])
			expect(await read(sql, "user", owner, artifact)).toEqual([
				{
					artifact_id: artifact,
					revision_id: current,
					access: "owner",
					pinned: false,
					org_only: false,
					download: true,
				},
			])
		}))
})

describe("visible_artifact anyone with the link (integration)", () => {
	it("opens an 'anyone' file to an anonymous reader naming it, by address only", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Public plan" })
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifact}`

			expect(await read(sql, "anonymous", artifact, artifact)).toEqual([
				{ artifact_id: artifact, revision_id: revision, access: "view", pinned: false, org_only: true, download: true },
			])
			expect(await sql`SELECT * FROM exagram.visible_artifacts('anonymous', ${artifact}::uuid)`).toEqual([])
			expect(
				await new SearchRepository(sql).search({
					principalKind: "anonymous",
					principalId: artifact,
					surface: "web",
					workspaceId: ws,
					query: "Public plan",
					limit: 20,
				}),
			).toEqual([])

			// Naming another Artifact as the principal opens nothing: the id is the address presented.
			const other = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Other" })
			expect(await read(sql, "anonymous", other, artifact)).toEqual([])

			for (const setting of ["restricted", "org"]) {
				await sql`UPDATE exagram.artifacts SET general_access = ${setting} WHERE id = ${artifact}`
				expect(await read(sql, "anonymous", artifact, artifact)).toEqual([])
			}
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone', current_revision_id = NULL WHERE id = ${artifact}`
			expect(await read(sql, "anonymous", artifact, artifact)).toEqual([])
			await sql`UPDATE exagram.artifacts SET current_revision_id = ${revision}, deleted_at = now() WHERE id = ${artifact}`
			expect(await read(sql, "anonymous", artifact, artifact)).toEqual([])
		}))

	it("opens an 'anyone' file to a user of another Workspace, who still gets no 'org' file", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const otherWs = await seedWorkspace(sql, "Other")
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const outsider = await seedUser(sql, { workspaceId: otherWs, email: "outsider@example.com" })
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${ws}, 'acme.test')`
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${outsider}, 'google', 'outsider', 'outsider@acme.test')`
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Plan" })
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)

			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifact}`
			expect(await read(sql, "user", outsider, artifact)).toEqual([
				{ artifact_id: artifact, revision_id: revision, access: "view", pinned: false, org_only: true, download: true },
			])
			expect(
				await new ArtifactsRepository(sql).listVisible(
					{ kind: "user", id: outsider },
					{ workspaceId: ws, scope: "all" },
				),
			).toEqual([])
			await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${artifact}`
			expect(await read(sql, "user", outsider, artifact)).toEqual([])
		}))

	it("keeps a removed member out of 'org', while 'anyone' still admits the account", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const removed = await seedUser(sql, { workspaceId: ws, email: "removed@example.com" })
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${ws}, 'acme.test')`
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${removed}, 'google', 'removed', 'removed@acme.test')`
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Plan" })
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)

			for (const [setting, afterRemoval] of [
				["anyone", 1],
				["org", 0],
			] as const) {
				await sql`UPDATE exagram.artifacts SET general_access = ${setting} WHERE id = ${artifact}`
				expect(await read(sql, "user", removed, artifact)).toHaveLength(1)
				await setRemoved(sql, removed, true)
				expect(await read(sql, "user", removed, artifact)).toHaveLength(afterRemoval)
				await setRemoved(sql, removed, false)
			}
		}))

	it("commentable_artifact keeps a Grant and a same-Workspace General Access reader, and drops the rest", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const otherWs = await seedWorkspace(sql, "Other")
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const colleague = await seedUser(sql, { workspaceId: ws, email: "colleague@example.com" })
			const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
			const outsider = await seedUser(sql, { workspaceId: otherWs, email: "outsider@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Plan" })
			const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, revision)
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifact}`
			await seedGrant(sql, { artifactId: artifact, granteeId: grantee, role: "view", createdBy: owner })
			const commentable = (kind: string, id: string) =>
				sql<Row[]>`SELECT * FROM exagram.commentable_artifact(${kind}, ${id}::uuid, ${artifact}::uuid)`

			// Everyone here reads the body.
			for (const [kind, id] of [
				["user", owner],
				["user", colleague],
				["user", grantee],
				["user", outsider],
				["anonymous", artifact],
			]) {
				expect(await read(sql, kind!, id!, artifact)).toHaveLength(1)
			}
			expect(await commentable("user", owner)).toMatchObject([{ access: "owner", org_only: false }])
			expect(await commentable("user", grantee)).toMatchObject([{ access: "view", org_only: false }])
			expect(await commentable("user", colleague)).toMatchObject([{ access: "view", org_only: true }])
			expect(await commentable("user", outsider)).toEqual([])
			expect(await commentable("anonymous", artifact)).toEqual([])

			// A Grant to the outsider reaches past the setting, as it does for reading.
			await seedGrant(sql, { artifactId: artifact, granteeId: outsider, role: "view", createdBy: owner })
			expect(await commentable("user", outsider)).toMatchObject([{ access: "view", org_only: false }])
		}))

	it("keeps a pinned Grant ahead of 'anyone', and never reaches a Connection or a Link", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const reader = await seedUser(sql, { workspaceId: ws, email: "reader@example.com" })
			const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Plan" })
			const first = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
			await approveRevision(sql, artifact, first)
			const current = await seedRevision(sql, { artifactId: artifact, seq: 2, authorUserId: owner })
			await approveRevision(sql, artifact, current)
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifact}`
			await seedGrant(sql, {
				artifactId: artifact,
				granteeId: reader,
				role: "view",
				pinnedRevisionId: first,
				createdBy: owner,
			})
			expect(await read(sql, "user", reader, artifact)).toEqual([
				{ artifact_id: artifact, revision_id: first, access: "view", pinned: true, org_only: false, download: true },
			])

			// The stranger would read 'anyone' in the browser; their Connection reaches only what a Grant gives.
			const stranger = await seedUser(sql, { workspaceId: ws, email: "stranger@example.com" })
			expect(await read(sql, "user", stranger, artifact)).toHaveLength(1)
			const connection = await seedConnection(sql, { userId: stranger })
			expect(await read(sql, "connection", connection, artifact)).toEqual([])
			const mcp = new McpRepository(sql)
			expect(await mcp.listArtifacts(connection, { limit: 20 })).toEqual([])
			expect(await mcp.searchArtifacts(connection, { query: "Plan", projectId: null, limit: 20 })).toEqual([])

			const other = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Other" })
			const otherRevision = await seedRevision(sql, { artifactId: other, seq: 1, authorUserId: owner })
			await approveRevision(sql, other, otherRevision)
			const link = await seedLink(sql, { artifactId: other, revisionId: otherRevision, createdBy: owner })
			expect(await read(sql, "link", link, artifact)).toEqual([])
		}))
})
