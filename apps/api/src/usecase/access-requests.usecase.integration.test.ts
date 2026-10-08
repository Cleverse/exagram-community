import { randomUUID } from "node:crypto"

import { AccessRequestsRepository } from "@exagram/core/repository/postgres/access-requests.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { NotificationsRepository } from "@exagram/core/repository/postgres/notifications.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { withDb } from "@exagram/core/test/pg"
import { seedUser } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { createRouterClient } from "@orpc/server"
import { describe, expect, it } from "vitest"

import { createAccessRequestsRouter } from "../routers/access-requests.router"

import { AccessRequestsUsecase } from "./access-requests.usecase"
import { GrantsUsecase } from "./grants.usecase"

import type { BaseContext } from "../plugins/context"
import type { Sql } from "postgres"

const build = (sql: Sql) => {
	const tx = new TransactionProvider(sql)
	const grants = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql), {
		tx,
	})
	return { grants, requests: new AccessRequestsUsecase(new AccessRequestsRepository(sql), grants, tx) }
}

const rows = (sql: Sql) =>
	sql<{ id: string; requester_id: string; note: string | null; role: string; resolution: string | null }[]>`
		SELECT id, requester_id, note, role, resolution FROM exagram.access_requests ORDER BY created_at`

const feed = (sql: Sql, userId: string, workspaceId: string) =>
	new NotificationsRepository(sql).listSince(userId, { notBefore: new Date(0), after: null, workspaceId }, 50)

/** The router over the real usecase, so a refusal is compared as the bytes the API sends. */
const clientAs = (usecase: AccessRequestsUsecase, userId: string, workspaceId: string) =>
	createRouterClient(
		createAccessRequestsRouter({
			accessRequestsUsecase: usecase,
			rate: { perMinute: 1000, take: () => true },
		}),
		{
			context: {
				headers: {},
				requestId: "r1",
				user: { id: userId, workspaceId, email: "x@example.com", name: "X", isAdmin: false, createdAt: new Date() },
			} as unknown as BaseContext,
		},
	)

const errorOf = (promise: Promise<unknown>) =>
	promise.then(
		() => null,
		(error: { code?: string; status?: number; message: string }) => ({
			code: error.code,
			status: error.status,
			message: error.message,
		}),
	)

describe("AccessRequestsUsecase (integration)", () => {
	it("answers the same for a missing id, another Workspace, a reached Artifact and the own one, and keeps only the real ask", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { grants, requests } = build(sql)
			const [other] = await sql<{ id: string }[]>`INSERT INTO exagram.workspaces (name) VALUES ('Other') RETURNING id`
			const stranger = await seedUser(sql, { workspaceId: other!.id, email: "stranger@example.com", name: "Stranger" })
			await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "view" })

			const answers = [
				await requests.create(fx.outsiderId, { artifactId: randomUUID() }),
				await requests.create(stranger, { artifactId: fx.artifactId }),
				await requests.create(fx.granteeId, { artifactId: fx.artifactId }),
				await requests.create(fx.ownerId, { artifactId: fx.artifactId }),
				await requests.create(fx.outsiderId, { artifactId: fx.artifactId, note: "  For the review  " }),
			]
			for (const answer of answers) expect(answer).toEqual({ sent: true })

			const kept = await rows(sql)
			expect(kept).toHaveLength(1)
			expect(kept[0]).toMatchObject({ requester_id: fx.outsiderId, note: "For the review", resolution: null })
		})
	})

	it("answers the same for a deleted Artifact and inside the dismiss cooldown, and keeps nothing", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId })
			const [open] = await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })
			await requests.dismiss(fx.ownerId, open!.id)

			const cooled = await requests.create(fx.outsiderId, { artifactId: fx.artifactId, note: "again" })
			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${fx.artifactId}`
			const deleted = await requests.create(fx.granteeId, { artifactId: fx.artifactId })

			expect(cooled).toEqual({ sent: true })
			expect(deleted).toEqual({ sent: true })
			const kept = await rows(sql)
			expect(kept).toHaveLength(1)
			expect(kept[0]).toMatchObject({ requester_id: fx.outsiderId, resolution: "dismissed" })
		})
	})

	it("refreshes an open request instead of opening a second", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)

			await requests.create(fx.outsiderId, { artifactId: fx.artifactId, note: "first" })
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId, note: "second", role: "edit" })

			const kept = await rows(sql)
			expect(kept).toHaveLength(1)
			expect(kept[0]).toMatchObject({ note: "second", role: "edit" })
		})
	})

	it("keeps the role asked for, view by default, and lists it to the Owner", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)

			await requests.create(fx.outsiderId, { artifactId: fx.artifactId })
			expect(await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })).toMatchObject([
				{ requesterId: fx.outsiderId, role: "view" },
			])
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId, role: "collaborate" })
			expect(await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })).toMatchObject([
				{ requesterId: fx.outsiderId, role: "collaborate" },
			])
		})
	})

	it("cancels only the caller's own open request, and answers the same for any id", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId })
			const outsider = clientAs(requests, fx.outsiderId, fx.workspaceId)
			const grantee = clientAs(requests, fx.granteeId, fx.workspaceId)

			const missing = await outsider.cancel({ body: { artifactId: randomUUID() } })
			const notTheirs = await grantee.cancel({ body: { artifactId: fx.artifactId } })
			expect(notTheirs).toEqual(missing)
			expect(await rows(sql)).toHaveLength(1)

			const own = await outsider.cancel({ body: { artifactId: fx.artifactId } })
			expect(own).toEqual(missing)
			expect(own).toEqual({ result: { canceled: true } })
			expect(await rows(sql)).toEqual([])
			expect(await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })).toEqual([])

			// Nothing open: the same answer again.
			expect(await outsider.cancel({ body: { artifactId: fx.artifactId } })).toEqual(missing)
		})
	})

	it("answers a granted requester with a decision naming the file and role, and no grant beside it", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId, role: "edit" })
			const [request] = await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })
			const { grant } = await requests.grant(fx.ownerId, request!.id, "collaborate")

			const items = await feed(sql, fx.outsiderId, fx.workspaceId)
			expect(items.filter((item) => item.kind === "decision")).toMatchObject([
				{
					id: request!.id,
					artifactId: fx.artifactId,
					title: "Quarterly plan",
					role: "collaborate",
					outcome: "granted",
					subject: "accessRequest",
				},
			])
			expect(items.map((item) => item.id)).not.toContain(grant.id)
			// The Owner's own feed no longer lists the request.
			expect((await feed(sql, fx.ownerId, fx.workspaceId)).filter((item) => item.kind === "accessRequest")).toEqual([])
		})
	})

	it("answers a declined requester with the Artifact's id only", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId, note: "please" })
			const [request] = await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })
			await requests.dismiss(fx.ownerId, request!.id)

			const items = await feed(sql, fx.outsiderId, fx.workspaceId)
			expect(items).toMatchObject([
				{
					id: request!.id,
					kind: "decision",
					artifactId: fx.artifactId,
					projectId: null,
					title: "",
					actorName: null,
					role: null,
					outcome: "declined",
					subject: "accessRequest",
					note: null,
				},
			])
			expect(JSON.stringify(items)).not.toContain("Quarterly plan")
			expect(JSON.stringify(items)).not.toContain("Owner")
			expect(JSON.stringify(items)).not.toContain("please")
		})
	})

	it("lists open requests to the Owner only", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId, note: "please" })

			const items = await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })
			expect(items).toHaveLength(1)
			expect(items[0]).toMatchObject({
				artifactId: fx.artifactId,
				artifactTitle: "Quarterly plan",
				requesterId: fx.outsiderId,
				requesterEmail: "outsider@example.com",
				requesterName: "Outsider",
				note: "please",
			})
			expect(await requests.list({ id: fx.granteeId, workspaceId: fx.workspaceId })).toEqual([])
			expect(await requests.list({ id: fx.outsiderId, workspaceId: fx.workspaceId })).toEqual([])
		})
	})

	it("grants through the Grant create path and closes the request", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId })
			const [request] = await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })

			const result = await requests.grant(fx.ownerId, request!.id, "collaborate")

			expect(result.id).toBe(request!.id)
			expect(result.grant).toMatchObject({ artifactId: fx.artifactId, granteeId: fx.outsiderId, role: "collaborate" })
			expect((await rows(sql))[0]!.resolution).toBe("granted")
			expect(await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })).toEqual([])
		})
	})

	it("refuses grant and dismiss to anyone but the Owner exactly as an unknown id", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { grants, requests } = build(sql)
			// An Editor still may not act on the Owner's requests.
			await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "edit" })
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId })
			const [request] = await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })
			const editor = clientAs(requests, fx.granteeId, fx.workspaceId)
			const owner = clientAs(requests, fx.ownerId, fx.workspaceId)

			const unknown = await errorOf(owner.grant({ params: { id: randomUUID() }, body: { role: "view" } }))
			expect(unknown).toMatchObject({ code: "NOT_FOUND", message: REFUSAL_TEXT })
			expect(await errorOf(editor.grant({ params: { id: request!.id }, body: { role: "view" } }))).toEqual(unknown)
			expect(await errorOf(editor.dismiss({ params: { id: request!.id } }))).toEqual(unknown)
			expect(await errorOf(owner.dismiss({ params: { id: randomUUID() } }))).toEqual(unknown)
			expect((await rows(sql))[0]!.resolution).toBeNull()

			// A closed request is as unknown as one that never was.
			await owner.dismiss({ params: { id: request!.id } })
			expect(await errorOf(owner.dismiss({ params: { id: request!.id } }))).toEqual(unknown)
			expect(await errorOf(owner.grant({ params: { id: request!.id }, body: { role: "view" } }))).toEqual(unknown)
		})
	})

	it("keeps a dismissed requester from asking again for a week", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId })
			const [request] = await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })

			expect(await requests.dismiss(fx.ownerId, request!.id)).toBe(request!.id)
			expect(await requests.create(fx.outsiderId, { artifactId: fx.artifactId })).toEqual({ sent: true })
			expect(await rows(sql)).toHaveLength(1)
			expect(await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })).toEqual([])

			await sql`UPDATE exagram.access_requests SET resolved_at = now() - interval '8 days'`
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId })
			expect(await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })).toHaveLength(1)
		})
	})

	it("leaves the request open when Restricted Shares refuses the Grant", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { requests } = build(sql)
			await requests.create(fx.outsiderId, { artifactId: fx.artifactId })
			const [request] = await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })
			await sql`UPDATE exagram.workspaces SET restricted_shares = true WHERE id = ${fx.workspaceId}::uuid`
			await sql`UPDATE exagram.projects SET restricted_shares = true WHERE id = ${fx.projectId}::uuid`
			await sql`UPDATE exagram.artifacts SET restricted_shares = true WHERE id = ${fx.artifactId}::uuid`

			await expect(requests.grant(fx.ownerId, request!.id, "view")).rejects.toThrow(REFUSAL_TEXT)

			expect((await rows(sql))[0]!.resolution).toBeNull()
			expect(await requests.list({ id: fx.ownerId, workspaceId: fx.workspaceId })).toHaveLength(1)
			const [grantCount] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM exagram.grants`
			expect(grantCount!.count).toBe(0)
		})
	})
})
