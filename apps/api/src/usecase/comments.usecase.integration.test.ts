import { randomUUID } from "node:crypto"

import { CommentsRepository } from "@exagram/core/repository/postgres/comments.repository"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { NotificationsRepository } from "@exagram/core/repository/postgres/notifications.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { withDb } from "@exagram/core/test/pg"
import { seedUser, seedWorkspace } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { PasswordRequiredError } from "@exagram/core/utils/errors"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { CommentsUsecase } from "./comments.usecase"
import { GrantsUsecase } from "./grants.usecase"

import type { Sql } from "postgres"

describe("CommentsUsecase under General Access 'anyone' (integration)", () => {
	it("refuses a signed-in person from another Workspace as a missing file, and makes no comment or notification", () =>
		withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const otherWs = await seedWorkspace(sql, "Other")
			const outsider = await seedUser(sql, { workspaceId: otherWs, email: "outsider@other.test" })
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${fx.artifactId}`
			const serve = buildServeService(sql)
			const usecase = new CommentsUsecase(new CommentsRepository(sql), serve)
			const missing = randomUUID()

			// The outsider reads the body.
			expect(await serve.resolveUnledgered({ kind: "user", id: outsider }, fx.artifactId)).toMatchObject({
				revisionId: fx.revisionTwoId,
				access: "view",
			})
			const refused = await refusalOf(usecase.list({ id: outsider, workspaceId: otherWs }, fx.artifactId))
			expect(refused.message).toBe(REFUSAL_TEXT)
			expect(await refusalOf(usecase.list({ id: outsider, workspaceId: otherWs }, missing))).toEqual(refused)
			expect(
				await refusalOf(usecase.create({ id: outsider, workspaceId: otherWs }, fx.revisionTwoId, "hello")),
			).toEqual(refused)
			expect(await refusalOf(usecase.create({ id: outsider, workspaceId: otherWs }, missing, "hello"))).toEqual(refused)

			expect(await sql`SELECT id FROM exagram.comments`).toEqual([])
			const notifications = new NotificationsRepository(sql)
			const since = new Date(Date.now() - 60_000)
			expect(
				await notifications.listSince(fx.ownerId, { notBefore: since, after: null, workspaceId: fx.workspaceId }, 20),
			).toEqual([])
			const rows = await sql<{ action: string; outcome: string; reason: string }[]>`
				SELECT c.action, s.outcome, s.reason
				FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${outsider}::uuid AND s.artifact_id = ${fx.artifactId}::uuid
				ORDER BY c.started_at`
			expect(rows).toEqual([
				{ action: "comments.list", outcome: "withheld", reason: "out-of-boundary" },
				{ action: "comments.create", outcome: "withheld", reason: "out-of-boundary" },
			])
		}))

	it("lets a member of the file's own Workspace comment, and tells the Owner", () =>
		withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${fx.artifactId}`
			const usecase = new CommentsUsecase(new CommentsRepository(sql), buildServeService(sql))

			const listed = await usecase.list({ id: fx.outsiderId, workspaceId: fx.workspaceId }, fx.artifactId)
			expect(listed).toEqual({ revisionId: fx.revisionTwoId, items: [] })
			const created = await usecase.create(
				{ id: fx.outsiderId, workspaceId: fx.workspaceId },
				fx.revisionTwoId,
				"from a colleague",
			)
			expect(created).toMatchObject({ body: "from a colleague", authorId: fx.outsiderId })

			const since = new Date(Date.now() - 60_000)
			const notifications = await new NotificationsRepository(sql).listSince(
				fx.ownerId,
				{ notBefore: since, after: null, workspaceId: fx.workspaceId },
				20,
			)
			expect(notifications).toMatchObject([{ kind: "comment", artifactId: fx.artifactId }])
		}))
})

describe("CommentsUsecase behind a password (ADR 0044, integration)", () => {
	const UNLOCK = "e".repeat(64)

	const protect = async (sql: Sql, artifactId: string) => {
		await sql`UPDATE exagram.artifacts SET general_access = 'anyone', anyone_password_hash = 'hash', anyone_password_on = true
			WHERE id = ${artifactId}::uuid`
		await sql`INSERT INTO exagram.anyone_unlocks (token_hash, artifact_id, expires_at)
			VALUES (${UNLOCK}, ${artifactId}::uuid, now() + interval '1 hour')`
	}

	it("lets a member of the file's own Workspace comment once the request carries the Unlock, and not before", () =>
		withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await protect(sql, fx.artifactId)
			const usecase = new CommentsUsecase(new CommentsRepository(sql), buildServeService(sql))
			const member = { id: fx.outsiderId, workspaceId: fx.workspaceId }

			await expect(usecase.list(member, fx.artifactId)).rejects.toBeInstanceOf(PasswordRequiredError)
			await expect(usecase.create(member, fx.revisionTwoId, "too early", () => undefined)).rejects.toBeInstanceOf(
				PasswordRequiredError,
			)
			expect(await sql`SELECT id FROM exagram.comments`).toEqual([])

			expect(await usecase.list(member, fx.artifactId, UNLOCK)).toEqual({ revisionId: fx.revisionTwoId, items: [] })
			const lookedUp: string[] = []
			const created = await usecase.create(member, fx.revisionTwoId, "after the password", (artifactId) => {
				lookedUp.push(artifactId)
				return UNLOCK
			})
			expect(created).toMatchObject({ body: "after the password", authorId: fx.outsiderId })
			expect(lookedUp).toEqual([fx.artifactId])

			const rows = await sql<{ action: string; outcome: string; reason: string | null }[]>`
				SELECT c.action, s.outcome, s.reason
				FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${fx.outsiderId}::uuid AND s.artifact_id = ${fx.artifactId}::uuid
				ORDER BY c.started_at`
			expect(rows).toEqual([
				{ action: "comments.list", outcome: "withheld", reason: "password-required" },
				{ action: "comments.create", outcome: "withheld", reason: "password-required" },
				{ action: "comments.list", outcome: "served", reason: null },
				{ action: "comments.create", outcome: "served", reason: null },
			])
		}))

	it("leaves a person from another Workspace a plain refusal even with the Unlock, as without the password", () =>
		withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await protect(sql, fx.artifactId)
			const otherWs = await seedWorkspace(sql, "Other")
			const outsider = await seedUser(sql, { workspaceId: otherWs, email: "outsider@other.test" })
			const usecase = new CommentsUsecase(new CommentsRepository(sql), buildServeService(sql))

			const refused = await refusalOf(usecase.list({ id: outsider, workspaceId: otherWs }, fx.artifactId, UNLOCK))
			expect(refused.message).toBe(REFUSAL_TEXT)
			expect(
				await refusalOf(usecase.create({ id: outsider, workspaceId: otherWs }, fx.revisionTwoId, "hi", () => UNLOCK)),
			).toEqual(refused)
			expect(await sql`SELECT id FROM exagram.comments`).toEqual([])
		}))
})

const refusalOf = async (read: Promise<unknown>): Promise<{ name: string; message: string }> => {
	try {
		await read
	} catch (error) {
		if (error instanceof Error) return { name: error.name, message: error.message }
		throw error
	}
	throw new Error("expected a refusal")
}

describe("CommentsUsecase (integration)", () => {
	it("never shows a pinned grantee the comments on v2", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const comments = new CommentsRepository(sql)
			const usecase = new CommentsUsecase(comments, serve)
			const grants = new GrantsUsecase(new GrantsRepository(sql), serve, new RevisionsRepository(sql))

			const grant = await grants.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			await grants.updatePin(fx.ownerId, grant.id, fx.revisionOneId)

			await comments.insert(fx.revisionOneId, fx.ownerId, "note on v1")
			await comments.insert(fx.revisionTwoId, fx.ownerId, "note on v2")

			const granteeView = await usecase.list({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId)
			expect(granteeView.revisionId).toBe(fx.revisionOneId)
			expect(granteeView.items.map((item) => item.body)).toEqual(["note on v1"])

			const ownerView = await usecase.list({ id: fx.ownerId, workspaceId: fx.workspaceId }, fx.artifactId)
			expect(ownerView.revisionId).toBe(fx.revisionTwoId)
			expect(ownerView.items.map((item) => item.body)).toEqual(["note on v2"])
		})
	})

	it("shows imported artifact-wide comments without exposing a pinned reader's unseen revision", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const comments = new CommentsRepository(sql)
			const usecase = new CommentsUsecase(comments, serve)
			const grants = new GrantsUsecase(new GrantsRepository(sql), serve, new RevisionsRepository(sql))
			const grant = await grants.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			await grants.updatePin(fx.ownerId, grant.id, fx.revisionOneId)
			const importedId = await comments.insert(fx.revisionTwoId, fx.ownerId, "imported source comment")
			await sql`UPDATE exagram.comments SET source_artifact_id = ${fx.artifactId},
				source_revision_id = ${fx.revisionTwoId} WHERE id = ${importedId}`
			await comments.insert(fx.revisionTwoId, fx.ownerId, "native v2 comment")

			const pinned = await usecase.list({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId)
			expect(pinned.revisionId).toBe(fx.revisionOneId)
			expect(pinned.items.map((item) => [item.body, item.revisionId])).toEqual([
				["imported source comment", fx.revisionOneId],
			])
			const owner = await usecase.list({ id: fx.ownerId, workspaceId: fx.workspaceId }, fx.artifactId)
			expect(owner.items.map((item) => item.body)).toEqual(["imported source comment", "native v2 comment"])
		})
	})

	it("refuses a comment written against a revision the reader does not resolve to", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const usecase = new CommentsUsecase(new CommentsRepository(sql), serve)
			const grants = new GrantsUsecase(new GrantsRepository(sql), serve, new RevisionsRepository(sql))

			const grant = await grants.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			await grants.updatePin(fx.ownerId, grant.id, fx.revisionOneId)

			const onPin = await usecase.create({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.revisionOneId, "fine")
			expect(onPin.revisionId).toBe(fx.revisionOneId)

			await expect(
				usecase.create({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.revisionTwoId, "leak"),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.create({ id: fx.outsiderId, workspaceId: fx.workspaceId }, fx.revisionOneId, "stranger"),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("ledgers the comment read against the resolved revision", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const usecase = new CommentsUsecase(new CommentsRepository(sql), serve)

			await usecase.list({ id: fx.ownerId, workspaceId: fx.workspaceId }, fx.artifactId)

			const [row] = await sql<{ action: string; outcome: string; revision_id: string }[]>`
				SELECT c.action, s.outcome, s.revision_id
				FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${fx.ownerId}`
			expect(row).toEqual({ action: "comments.list", outcome: "served", revision_id: fx.revisionTwoId })
		})
	})
})
