import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { seedArtifact, seedConnection, seedProject, seedRevision, seedUser, seedWorkspace } from "../../test/seed"

import type { Sql } from "postgres"

const approve = (sql: Sql, revisionId: string, approverId: string, confirm: boolean) =>
	sql<{ approved: string | null }[]>`
		SELECT "exagram".approve_revision(${revisionId}, ${approverId}, ${confirm}) AS approved
	`

describe("approve_revision placeholder guard (integration)", () => {
	const seedPending = async (
		sql: Sql,
		options: { byConnection: boolean; placeholderTypes: string[]; redactionStatus: string; kind?: "doc" | "image" },
	) => {
		const workspaceId = await seedWorkspace(sql)
		const ownerId = await seedUser(sql, { workspaceId, email: "owner@example.test" })
		const projectId = await seedProject(sql, { workspaceId, ownerId, name: "p" })
		const artifactId = await seedArtifact(sql, {
			workspaceId,
			ownerId,
			projectId,
			title: "a",
			kind: options.kind ?? "doc",
		})
		const connectionId = options.byConnection ? await seedConnection(sql, { userId: ownerId }) : undefined
		const revisionId = await seedRevision(sql, {
			artifactId,
			seq: 1,
			authorUserId: ownerId,
			...(connectionId ? { authorConnectionId: connectionId } : {}),
		})
		await sql`
			UPDATE "exagram"."revisions"
			SET placeholder_types = ${sql.array(options.placeholderTypes)}::text[], redaction_status = ${options.redactionStatus}
			WHERE id = ${revisionId}
		`
		return { ownerId, artifactId, revisionId }
	}

	it("approves a Connection's Revision with no placeholder without confirmation", async () => {
		await withDb(async (sql) => {
			const fx = await seedPending(sql, { byConnection: true, placeholderTypes: [], redactionStatus: "done" })
			const [row] = await approve(sql, fx.revisionId, fx.ownerId, false)
			expect(row!.approved).toBe(fx.revisionId)
		})
	})

	it("approves a Connection's Revision once the null detector marked it done at version 0", async () => {
		await withDb(async (sql) => {
			const fx = await seedPending(sql, { byConnection: true, placeholderTypes: [], redactionStatus: "done" })
			await sql`
				UPDATE "exagram"."revisions" SET redacted_text = '', redaction_detector_version = 0 WHERE id = ${fx.revisionId}
			`
			const [row] = await approve(sql, fx.revisionId, fx.ownerId, false)
			expect(row!.approved).toBe(fx.revisionId)
		})
	})

	it("refuses a Connection's Revision that carries a placeholder until it is confirmed", async () => {
		await withDb(async (sql) => {
			const fx = await seedPending(sql, { byConnection: true, placeholderTypes: ["EMAIL"], redactionStatus: "done" })
			await expect(approve(sql, fx.revisionId, fx.ownerId, false)).rejects.toMatchObject({ code: "EXR02" })
			const [row] = await approve(sql, fx.revisionId, fx.ownerId, true)
			expect(row!.approved).toBe(fx.revisionId)
		})
	})

	it("refuses a NULL placeholder confirmation for a Connection's Revision", async () => {
		await withDb(async (sql) => {
			const fx = await seedPending(sql, { byConnection: true, placeholderTypes: ["EMAIL"], redactionStatus: "done" })
			await expect(sql`SELECT "exagram".approve_revision(${fx.revisionId}, ${fx.ownerId}, NULL)`).rejects.toMatchObject(
				{ code: "EXR02" },
			)
		})
	})

	it("refuses a Connection's Revision whose redaction has not run, confirmed or not", async () => {
		await withDb(async (sql) => {
			const fx = await seedPending(sql, { byConnection: true, placeholderTypes: [], redactionStatus: "queued" })
			await expect(approve(sql, fx.revisionId, fx.ownerId, false)).rejects.toMatchObject({ code: "EXR01" })
			await expect(approve(sql, fx.revisionId, fx.ownerId, true)).rejects.toMatchObject({ code: "EXR01" })
		})
	})

	it("approves a Connection's image, which the redact job leaves at 'none', without waiting on redaction", async () => {
		await withDb(async (sql) => {
			const fx = await seedPending(sql, {
				byConnection: true,
				placeholderTypes: [],
				redactionStatus: "none",
				kind: "image",
			})
			const [row] = await approve(sql, fx.revisionId, fx.ownerId, false)
			expect(row!.approved).toBe(fx.revisionId)
		})
	})

	it("leaves a person's own Revision alone, placeholders and redaction status included", async () => {
		await withDb(async (sql) => {
			const fx = await seedPending(sql, { byConnection: false, placeholderTypes: ["EMAIL"], redactionStatus: "queued" })
			const [row] = await approve(sql, fx.revisionId, fx.ownerId, false)
			expect(row!.approved).toBe(fx.revisionId)
		})
	})

	it("still answers NULL, not an error, to someone who is not the Approver", async () => {
		await withDb(async (sql) => {
			const fx = await seedPending(sql, { byConnection: true, placeholderTypes: ["EMAIL"], redactionStatus: "done" })
			const workspaceId = await seedWorkspace(sql)
			const stranger = await seedUser(sql, { workspaceId, email: "stranger@example.test" })
			const [row] = await approve(sql, fx.revisionId, stranger, false)
			expect(row!.approved).toBeNull()
		})
	})
})
