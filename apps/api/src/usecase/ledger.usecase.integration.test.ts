import { CommentsRepository } from "@exagram/core/repository/postgres/comments.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { withDb } from "@exagram/core/test/pg"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { CommentsUsecase } from "./comments.usecase"
import { LedgerUsecase } from "./ledger.usecase"

import type { Sql } from "postgres"

const adminOf = (workspaceId: string) => ({ workspaceId, isAdmin: true })

/**
 * One call at an exact, microsecond started_at, with one serve row per entry in `serves`. The value
 * goes in as text: bound as a timestamptz, postgres.js would round-trip it through a Date and drop
 * the microseconds.
 */
const seedCall = async (
	sql: Sql,
	userId: string,
	startedAt: string,
	serves: { artifactId: string; outcome: "served" | "withheld" }[],
): Promise<string> => {
	const [call] = await sql<{ id: string }[]>`
		INSERT INTO exagram.ledger_calls (principal_kind, principal_id, surface, action, status, started_at)
		VALUES ('user', ${userId}, 'web', 'artifacts.list', 'delivered', ${startedAt}::text::timestamptz) RETURNING id`
	for (const serve of serves) {
		await sql`
			INSERT INTO exagram.ledger_serves (call_id, artifact_id, outcome, reason)
			VALUES (${call!.id}, ${serve.artifactId}, ${serve.outcome},
				${serve.outcome === "withheld" ? "not-found" : null})`
	}
	return call!.id
}

/** Walks every page with `limit` and returns all rows in order. */
const drain = async <T>(
	fetch: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> => {
	const all: T[] = []
	let cursor: string | undefined
	for (let guard = 0; guard < 50; guard += 1) {
		const page = await fetch(cursor)
		all.push(...page.items)
		if (page.nextCursor === null) return all
		cursor = page.nextCursor
	}
	throw new Error("paging did not terminate")
}

describe("LedgerUsecase (integration)", () => {
	it("gives the owner their artifact's rows and pages with a cursor", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const comments = new CommentsUsecase(new CommentsRepository(sql), serve)
			const usecase = new LedgerUsecase(new LedgerRepository(sql), serve)

			for (let index = 0; index < 3; index += 1)
				await comments.list({ id: fx.ownerId, workspaceId: fx.workspaceId }, fx.artifactId)

			const first = await usecase.forArtifact(fx.ownerId, fx.artifactId, { limit: 2 })
			expect(first.items).toHaveLength(2)
			expect(first.nextCursor).not.toBeNull()

			const second = await usecase.forArtifact(fx.ownerId, fx.artifactId, {
				limit: 2,
				cursor: first.nextCursor ?? undefined,
			})
			expect(second.items).toHaveLength(1)
			expect(second.nextCursor).toBeNull()
			expect(second.items[0]!.callId).not.toBe(first.items[0]!.callId)
		})
	})

	it("refuses forArtifact to a grantee and activity to a non-admin", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const usecase = new LedgerUsecase(new LedgerRepository(sql), serve)
			await sql`INSERT INTO exagram.grants (artifact_id, grantee_id, role, created_by)
				VALUES (${fx.artifactId}, ${fx.granteeId}, 'view', ${fx.ownerId})`

			await expect(usecase.forArtifact(fx.granteeId, fx.artifactId, { limit: 50 })).rejects.toThrow(REFUSAL_TEXT)
			await expect(usecase.activity({ workspaceId: fx.workspaceId, isAdmin: false }, { limit: 50 })).rejects.toThrow(
				REFUSAL_TEXT,
			)
		})
	})

	it("keeps an admin inside their own workspace", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const comments = new CommentsUsecase(new CommentsRepository(sql), serve)
			const usecase = new LedgerUsecase(new LedgerRepository(sql), serve)
			const [other] = await sql<{ id: string }[]>`
				INSERT INTO exagram.workspaces (name) VALUES ('Other') RETURNING id`
			const outsideAdmin = adminOf(other!.id)

			await comments.list({ id: fx.ownerId, workspaceId: fx.workspaceId }, fx.artifactId)

			expect((await usecase.activity(outsideAdmin, { limit: 50 })).items).toEqual([])
			expect((await usecase.activity(adminOf(fx.workspaceId), { limit: 50 })).items).toHaveLength(1)
		})
	})

	it("gives an admin every row across owners in their workspace", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const comments = new CommentsUsecase(new CommentsRepository(sql), serve)
			const usecase = new LedgerUsecase(new LedgerRepository(sql), serve)
			const admin = adminOf(fx.workspaceId)

			await comments.list({ id: fx.ownerId, workspaceId: fx.workspaceId }, fx.artifactId)
			await expect(comments.list({ id: fx.outsiderId, workspaceId: fx.workspaceId }, fx.artifactId)).rejects.toThrow(
				REFUSAL_TEXT,
			)

			const page = await usecase.activity(admin, { limit: 50 })
			expect(page.items.map((item) => item.outcome).sort()).toEqual(["served", "withheld"])
		})
	})

	it("folds served body reads into one row per person, Project grantees included, and only for the Owner", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const comments = new CommentsUsecase(new CommentsRepository(sql), serve)
			const usecase = new LedgerUsecase(new LedgerRepository(sql), serve)
			await sql`INSERT INTO exagram.grants (artifact_id, grantee_id, role, created_by)
				VALUES (${fx.artifactId}, ${fx.granteeId}, 'view', ${fx.ownerId})`
			await sql`INSERT INTO exagram.grants (project_id, grantee_id, role, created_by)
				VALUES (${fx.projectId}, ${fx.outsiderId}, 'view', ${fx.ownerId})`
			const open = (userId: string, action: string) =>
				serve.resolve({
					principal: { kind: "user", id: userId, workspaceId: fx.workspaceId },
					surface: "web",
					action,
					artifactId: fx.artifactId,
					requireRevision: false,
				})

			await open(fx.granteeId, "artifacts.get")
			await open(fx.granteeId, "revisions.text")
			await open(fx.outsiderId, "artifacts.get")
			await open(fx.ownerId, "artifacts.get")
			// Listing or reading comments is not opening the file.
			await comments.list({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId)

			const viewers = await usecase.viewers(fx.ownerId, fx.artifactId)
			expect(viewers.map((viewer) => [viewer.userId, viewer.count]).sort()).toEqual(
				[
					[fx.granteeId, 2],
					[fx.outsiderId, 1],
				].sort(),
			)
			const grantee = viewers.find((viewer) => viewer.userId === fx.granteeId)!
			expect(grantee).toMatchObject({ name: "Grantee", email: fx.granteeEmail })
			expect(grantee.firstOpenedAt.getTime()).toBeLessThanOrEqual(grantee.lastOpenedAt.getTime())

			await expect(usecase.viewers(fx.granteeId, fx.artifactId)).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("pages Activity on the serve row, so a call's rows crossing a page boundary all appear once", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new LedgerUsecase(new LedgerRepository(sql), buildServeService(sql))
			const admin = adminOf(fx.workspaceId)
			const missing = "99999999-9999-4999-8999-999999999999"
			// A list call that served three Artifacts and Withheld two, then an older single read.
			const listCall = await seedCall(sql, fx.ownerId, "2026-01-01T00:00:01.000000Z", [
				{ artifactId: fx.artifactId, outcome: "served" },
				{ artifactId: fx.artifactId, outcome: "served" },
				{ artifactId: missing, outcome: "withheld" },
				{ artifactId: fx.artifactId, outcome: "served" },
				{ artifactId: missing, outcome: "withheld" },
			])
			const readCall = await seedCall(sql, fx.ownerId, "2026-01-01T00:00:00.000000Z", [
				{ artifactId: fx.artifactId, outcome: "served" },
			])
			const [{ count } = { count: 0 }] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM exagram.ledger_serves`
			expect(count).toBe(6)

			const rows = await drain((cursor) => usecase.activity(admin, { limit: 2, cursor }))

			expect(rows).toHaveLength(6)
			expect(rows.map((row) => row.callId)).toEqual([listCall, listCall, listCall, listCall, listCall, readCall])
			expect(rows.filter((row) => row.outcome === "withheld").map((row) => row.artifactId)).toEqual([missing, missing])
		})
	})

	it("pages an Artifact's Ledger on the serve row, including a page boundary inside one call", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new LedgerUsecase(new LedgerRepository(sql), buildServeService(sql))
			const callId = await seedCall(sql, fx.ownerId, "2026-01-01T00:00:01.000000Z", [
				{ artifactId: fx.artifactId, outcome: "served" },
				{ artifactId: fx.artifactId, outcome: "withheld" },
				{ artifactId: fx.artifactId, outcome: "served" },
			])
			const serveIds = await sql<{ id: string }[]>`
				SELECT id FROM exagram.ledger_serves WHERE call_id = ${callId}::uuid`
			expect(serveIds).toHaveLength(3)

			const rows = await drain((cursor) => usecase.forArtifact(fx.ownerId, fx.artifactId, { limit: 2, cursor }))

			expect(rows.map((row) => row.callId)).toEqual([callId, callId, callId])
			expect(rows.map((row) => row.outcome).sort()).toEqual(["served", "served", "withheld"])
		})
	})

	it("keeps two calls started in the same millisecond on separate pages", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new LedgerUsecase(new LedgerRepository(sql), buildServeService(sql))
			const admin = adminOf(fx.workspaceId)
			const later = await seedCall(sql, fx.ownerId, "2026-01-01T00:00:00.000200Z", [
				{ artifactId: fx.artifactId, outcome: "served" },
			])
			const earlier = await seedCall(sql, fx.ownerId, "2026-01-01T00:00:00.000100Z", [
				{ artifactId: fx.artifactId, outcome: "served" },
			])

			const stored = await sql<{ startedAt: string }[]>`
				SELECT to_char(started_at AT TIME ZONE 'UTC', 'SS.US') AS "startedAt"
				FROM exagram.ledger_calls ORDER BY started_at`
			expect(stored.map((row) => row.startedAt)).toEqual(["00.000100", "00.000200"])

			const first = await usecase.activity(admin, { limit: 1 })
			expect(first.items.map((row) => row.callId)).toEqual([later])
			const second = await usecase.activity(admin, { limit: 1, cursor: first.nextCursor ?? undefined })
			expect(second.items.map((row) => row.callId)).toEqual([earlier])

			const forArtifact = await drain((cursor) => usecase.forArtifact(fx.ownerId, fx.artifactId, { limit: 1, cursor }))
			expect(forArtifact.map((row) => row.callId)).toEqual([later, earlier])
		})
	})

	it("refuses a cursor it did not issue", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new LedgerUsecase(new LedgerRepository(sql), buildServeService(sql))
			const admin = adminOf(fx.workspaceId)
			const callId = "11111111-1111-4111-8111-111111111111"

			for (const cursor of ["garbage", `2026-01-01T00:00:00.000Z|${callId}`, `2026-01-01T00:00:00.000000Z|x|y`]) {
				await expect(usecase.activity(admin, { limit: 2, cursor })).rejects.toThrow(REFUSAL_TEXT)
			}
		})
	})
})
