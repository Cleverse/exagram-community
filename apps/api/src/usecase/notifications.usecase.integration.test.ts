import { NOTIFICATIONS_LIMIT } from "@exagram/core/contract/notifications/type"
import { NotificationsRepository } from "@exagram/core/repository/postgres/notifications.repository"
import { withDb } from "@exagram/core/test/pg"
import { approveRevision, seedArtifact, seedRevision, seedUser, seedWorkspace } from "@exagram/core/test/seed"
import { BadRequestError } from "@exagram/core/utils/errors"
import { describe, expect, it } from "vitest"

import { NotificationsUsecase } from "./notifications.usecase"

import type { Sql } from "postgres"

/** Me owns a file with one approved Revision; Bo comments on it. */
const seed = async (sql: Sql) => {
	const ws = await seedWorkspace(sql)
	const me = await seedUser(sql, { workspaceId: ws, email: "me@example.com", name: "Me" })
	const bo = await seedUser(sql, { workspaceId: ws, email: "bo@example.com", name: "Bo" })
	const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: me, title: "Mine" })
	const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: me, status: "approved" })
	await approveRevision(sql, artifact, revision)
	const comment = async (db: Sql = sql): Promise<string> => {
		const [row] = await db<{ id: string }[]>`
			INSERT INTO "exagram"."comments" ("revision_id", "author_id", "body")
			VALUES (${revision}, ${bo}, 'body') RETURNING "id"`
		return row!.id
	}
	return { me: { id: me, workspaceId: ws }, comment }
}

describe("NotificationsUsecase.list against Postgres", () => {
	it("pages through more than a page of rows sharing one timestamp, each exactly once", async () => {
		await withDb(async (sql) => {
			const s = await seed(sql)
			// One transaction: every created_at is the same now().
			await sql.begin(async (tx) => {
				for (let i = 0; i < NOTIFICATIONS_LIMIT + 10; i++) await s.comment(tx as unknown as Sql)
			})
			const usecase = new NotificationsUsecase(new NotificationsRepository(sql))
			const since = new Date(Date.now() - 60_000)

			const first = await usecase.list(s.me, { since })
			expect(first.items).toHaveLength(NOTIFICATIONS_LIMIT)
			expect(first.next).not.toBeNull()

			// `after` wins over `since`, which on its own would return the first page again.
			const second = await usecase.list(s.me, { since, after: first.next! })
			expect(second.items).toHaveLength(10)
			expect(second.next).toBeNull()

			const ids = [...first.items, ...second.items].map((item) => item.id)
			expect(new Set(ids).size).toBe(NOTIFICATIONS_LIMIT + 10)
			expect(first.items[0]).not.toHaveProperty("cursorAt")
		})
	})

	it("refuses an `after` the server never gave out", async () => {
		await withDb(async (sql) => {
			const s = await seed(sql)
			const usecase = new NotificationsUsecase(new NotificationsRepository(sql))
			await expect(usecase.list(s.me, { after: "not-a-cursor" })).rejects.toBeInstanceOf(BadRequestError)
		})
	})

	it("reaches back at most 7 days, however old `since` is", async () => {
		await withDb(async (sql) => {
			const s = await seed(sql)
			const old = await s.comment()
			const recent = await s.comment()
			await sql`UPDATE "exagram"."comments" SET "created_at" = now() - interval '8 days' WHERE "id" = ${old}`
			await sql`UPDATE "exagram"."comments" SET "created_at" = now() - interval '6 days' WHERE "id" = ${recent}`

			const page = await new NotificationsUsecase(new NotificationsRepository(sql)).list(s.me, { since: new Date(0) })
			expect(page.items.map((item) => item.id)).toEqual([recent])
		})
	})
})
