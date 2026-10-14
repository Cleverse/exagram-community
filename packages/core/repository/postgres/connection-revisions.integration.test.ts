import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedGrant,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
	softDeleteArtifact,
} from "../../test/seed"

import type { Sql } from "postgres"

interface ReadableRow {
	seq: number
	status: string
}

const readable = (sql: Sql, connectionId: string, artifactId: string): Promise<ReadableRow[]> =>
	sql<ReadableRow[]>`
		SELECT seq, status FROM "exagram".connection_readable_revisions(${connectionId}::uuid)
		WHERE artifact_id = ${artifactId}::uuid ORDER BY seq
	`

/**
 * Owner O owns Project P; Artifact A in P at seq 1 approved (superseded), seq 2 approved
 * (Current), seq 3 pending authored by G's Connection cG, seq 4 discarded authored by cG, seq 5
 * pending authored by O in the app. G holds a direct edit Grant on A, H a direct view Grant.
 */
async function buildFixture(sql: Sql) {
	const ws = await seedWorkspace(sql)
	const O = await seedUser(sql, { workspaceId: ws, email: "o@example.com" })
	const G = await seedUser(sql, { workspaceId: ws, email: "g@example.com" })
	const H = await seedUser(sql, { workspaceId: ws, email: "h@example.com" })
	const P = await seedProject(sql, { workspaceId: ws, ownerId: O, name: "P" })
	const A = await seedArtifact(sql, { workspaceId: ws, ownerId: O, projectId: P, title: "A" })

	const cO = await seedConnection(sql, { userId: O })
	const cG = await seedConnection(sql, { userId: G })
	const cH = await seedConnection(sql, { userId: H })
	const cG2 = await seedConnection(sql, { userId: G })

	const v1 = await seedRevision(sql, { artifactId: A, seq: 1, authorUserId: O })
	await approveRevision(sql, A, v1)
	const v2 = await seedRevision(sql, { artifactId: A, seq: 2, authorUserId: O })
	await approveRevision(sql, A, v2)
	const v3 = await seedRevision(sql, { artifactId: A, seq: 3, authorUserId: G, authorConnectionId: cG })
	const v4 = await seedRevision(sql, {
		artifactId: A,
		seq: 4,
		authorUserId: G,
		authorConnectionId: cG,
		status: "discarded",
	})
	const v5 = await seedRevision(sql, { artifactId: A, seq: 5, authorUserId: O })

	const grantG = await seedGrant(sql, { artifactId: A, granteeId: G, role: "edit", createdBy: O })
	const grantH = await seedGrant(sql, { artifactId: A, granteeId: H, role: "view", createdBy: O })

	return { ws, O, G, H, P, A, cO, cG, cH, cG2, v1, v2, v3, v4, v5, grantG, grantH }
}

describe("connection_readable_revisions", () => {
	it("reads everything on the Artifact for the Owner's connection", () =>
		withDb(async (sql) => {
			const { cO, A } = await buildFixture(sql)

			expect((await readable(sql, cO, A)).map((r) => r.seq)).toEqual([1, 2, 3, 4, 5])
		}))

	it("reads the Current Revision and its own pending Revision for the authoring connection", () =>
		withDb(async (sql) => {
			const { cG, A } = await buildFixture(sql)

			expect((await readable(sql, cG, A)).map((r) => r.seq)).toEqual([2, 3])
		}))

	it("keeps authorship per Connection: the same person's other AI tool does not inherit it", () =>
		withDb(async (sql) => {
			const { cG2, A } = await buildFixture(sql)

			expect((await readable(sql, cG2, A)).map((r) => r.seq)).toEqual([2])
		}))

	it("reads only the Current Revision for a grantee who wrote nothing", () =>
		withDb(async (sql) => {
			const { cH, A } = await buildFixture(sql)

			expect((await readable(sql, cH, A)).map((r) => r.seq)).toEqual([2])
		}))

	it("reads nothing once the connection is revoked", () =>
		withDb(async (sql) => {
			const { cG, A } = await buildFixture(sql)
			await sql`UPDATE "exagram"."connections" SET "revoked_at" = now() WHERE "id" = ${cG}`

			expect(await readable(sql, cG, A)).toEqual([])
		}))

	it("reads nothing once the authoring grantee's Grant is removed", () =>
		withDb(async (sql) => {
			const { cG, grantG, A } = await buildFixture(sql)
			await sql`DELETE FROM "exagram"."grants" WHERE "id" = ${grantG}`

			expect(await readable(sql, cG, A)).toEqual([])
		}))

	it("reads nothing once the Artifact moves out of a Project Grant the author held instead of a direct one", () =>
		withDb(async (sql) => {
			const { ws, O, P, A } = await buildFixture(sql)
			const J = await seedUser(sql, { workspaceId: ws, email: "j@example.com" })
			await seedGrant(sql, { projectId: P, granteeId: J, role: "edit", createdBy: O })
			const cJ = await seedConnection(sql, { userId: J })
			await seedRevision(sql, { artifactId: A, seq: 6, authorUserId: J, authorConnectionId: cJ })

			expect((await readable(sql, cJ, A)).map((r) => r.seq)).toEqual([2, 6])

			const X = await seedUser(sql, { workspaceId: ws, email: "x@example.com" })
			const Q = await seedProject(sql, { workspaceId: ws, ownerId: X, name: "Q" })
			await sql`UPDATE "exagram"."artifacts" SET "project_id" = ${Q} WHERE "id" = ${A}`

			expect(await readable(sql, cJ, A)).toEqual([])
		}))

	it("keeps reading through a direct Grant after the same move: it never depended on the Project", () =>
		withDb(async (sql) => {
			const { ws, cG, A } = await buildFixture(sql)
			const X = await seedUser(sql, { workspaceId: ws, email: "x@example.com" })
			const Q = await seedProject(sql, { workspaceId: ws, ownerId: X, name: "Q" })
			await sql`UPDATE "exagram"."artifacts" SET "project_id" = ${Q} WHERE "id" = ${A}`

			expect((await readable(sql, cG, A)).map((r) => r.seq)).toEqual([2, 3])
		}))

	it("reads nothing for the Owner once the Artifact moves to another Owner's Project", () =>
		withDb(async (sql) => {
			const { ws, cO, A } = await buildFixture(sql)
			const X = await seedUser(sql, { workspaceId: ws, email: "x@example.com" })
			const Q = await seedProject(sql, { workspaceId: ws, ownerId: X, name: "Q" })
			await sql`UPDATE "exagram"."artifacts" SET "project_id" = ${Q} WHERE "id" = ${A}`

			expect(await readable(sql, cO, A)).toEqual([])
		}))

	it("reads only the Current Revision for the former Owner who holds a view Grant on the new Project", () =>
		withDb(async (sql) => {
			const { ws, O, cO, A } = await buildFixture(sql)
			const X = await seedUser(sql, { workspaceId: ws, email: "x@example.com" })
			const Q = await seedProject(sql, { workspaceId: ws, ownerId: X, name: "Q" })
			await sql`UPDATE "exagram"."artifacts" SET "project_id" = ${Q} WHERE "id" = ${A}`
			await seedGrant(sql, { projectId: Q, granteeId: O, role: "view", createdBy: X })

			expect((await readable(sql, cO, A)).map((r) => r.seq)).toEqual([2])
		}))

	it("never lets a pinned grantee learn a newer Revision exists", () =>
		withDb(async (sql) => {
			const { cH, grantH, v1, A } = await buildFixture(sql)
			await sql`UPDATE "exagram"."grants" SET "pinned_revision_id" = ${v1} WHERE "id" = ${grantH}`

			expect((await readable(sql, cH, A)).map((r) => r.seq)).toEqual([1])
		}))

	it("reads nothing for anyone once the Artifact is soft-deleted", () =>
		withDb(async (sql) => {
			const { cO, cG, cH, A } = await buildFixture(sql)
			await softDeleteArtifact(sql, A)

			expect(await readable(sql, cO, A)).toEqual([])
			expect(await readable(sql, cG, A)).toEqual([])
			expect(await readable(sql, cH, A)).toEqual([])
		}))

	describe("a pending-only Artifact reached only through a Project Grant", () => {
		it("reads it for the author, the Owner, and not for a grantee who did not write it", () =>
			withDb(async (sql) => {
				const ws = await seedWorkspace(sql)
				const O = await seedUser(sql, { workspaceId: ws, email: "o2@example.com" })
				const G = await seedUser(sql, { workspaceId: ws, email: "g2@example.com" })
				const H = await seedUser(sql, { workspaceId: ws, email: "h2@example.com" })
				const P = await seedProject(sql, { workspaceId: ws, ownerId: O, name: "P" })
				await seedGrant(sql, { projectId: P, granteeId: G, role: "edit", createdBy: O })
				await seedGrant(sql, { projectId: P, granteeId: H, role: "view", createdBy: O })

				const cO = await seedConnection(sql, { userId: O })
				const cG = await seedConnection(sql, { userId: G })
				const cH = await seedConnection(sql, { userId: H })

				const B = await seedArtifact(sql, { workspaceId: ws, ownerId: G, projectId: P, title: "B" })
				await seedRevision(sql, { artifactId: B, seq: 1, authorUserId: G, authorConnectionId: cG })

				expect((await readable(sql, cG, B)).map((r) => r.seq)).toEqual([1])
				expect((await readable(sql, cO, B)).map((r) => r.seq)).toEqual([1])
				expect(await readable(sql, cH, B)).toEqual([])
			}))
	})
})
