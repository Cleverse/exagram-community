import { createHash, randomUUID } from "node:crypto"

import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { verifyUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { withDb } from "@exagram/core/test/pg"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { GrantsUsecase } from "./grants.usecase"
import { RevisionBodyUsecase } from "./revision-body.usecase"
import { RevisionPreviewUsecase } from "./revision-preview.usecase"

import type { Sql } from "postgres"

const SECRET = "s".repeat(32)

describe("RevisionBodyUsecase (integration)", () => {
	it("mints a token for the revision the reader resolves to and ledgers the mint", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const grants = new GrantsUsecase(new GrantsRepository(sql), serve, new RevisionsRepository(sql))
			const usecase = new RevisionBodyUsecase(
				serve,
				SECRET,
				"https://uc.exagram.test",
				300,
				new RevisionsRepository(sql),
			)

			const grant = await grants.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			await grants.updatePin(fx.ownerId, grant.id, fx.revisionOneId)

			const minted = await usecase.bodyToken(
				{ kind: "user", id: fx.granteeId, workspaceId: fx.workspaceId },
				fx.artifactId,
			)
			expect(minted.revisionId).toBe(fx.revisionOneId)
			expect(minted.expiresInSeconds).toBe(300)
			const token = minted.url.replace("https://uc.exagram.test/uc/", "")
			expect(verifyUsercontentToken(token, SECRET)).toEqual({
				ok: true,
				revisionId: fx.revisionOneId,
				callId: null,
			})

			const [row] = await sql<{ action: string; outcome: string; body_sha256: string }[]>`
				SELECT c.action, s.outcome, c.body_sha256
				FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${fx.granteeId}`
			expect(row).toEqual({ action: "revisions.bodyToken", outcome: "served", body_sha256: "sha-v1" })
		})
	})

	it("refuses a reader with no grant and leaves a withheld row", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const usecase = new RevisionBodyUsecase(
				serve,
				SECRET,
				"https://uc.exagram.test",
				300,
				new RevisionsRepository(sql),
			)

			await expect(
				usecase.bodyToken({ kind: "user", id: fx.outsiderId, workspaceId: fx.workspaceId }, fx.artifactId),
			).rejects.toThrow(REFUSAL_TEXT)

			const [row] = await sql<{ outcome: string }[]>`
				SELECT s.outcome FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${fx.outsiderId}`
			expect(row!.outcome).toBe("withheld")
		})
	})

	it("refuses an artifact whose only revision is pending", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const usecase = new RevisionBodyUsecase(
				serve,
				SECRET,
				"https://uc.exagram.test",
				300,
				new RevisionsRepository(sql),
			)
			const [fresh] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.projectId}, 'html', 'Nothing yet')
				RETURNING id`

			await expect(
				usecase.bodyToken({ kind: "user", id: fx.ownerId, workspaceId: fx.workspaceId }, fresh!.id),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("mints the Owner a token for a Pending Revision before it is approved, and ledgers it", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const usecase = new RevisionBodyUsecase(
				serve,
				SECRET,
				"https://uc.exagram.test",
				300,
				new RevisionsRepository(sql),
			)
			const [fresh] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.projectId}, 'html', 'Draft')
				RETURNING id`
			const [pending] = await sql<{ id: string }[]>`
				INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${fresh!.id}, 1, ${fx.ownerId}, 'artifacts/draft.html', 'text/html', 11, 'sha-draft')
				RETURNING id`

			const minted = await usecase.bodyTokenAt({ id: fx.ownerId, workspaceId: fx.workspaceId }, fresh!.id, pending!.id)
			expect(minted.revisionId).toBe(pending!.id)
			const token = minted.url.replace("https://uc.exagram.test/uc/", "")
			expect(verifyUsercontentToken(token, SECRET)).toEqual({ ok: true, revisionId: pending!.id, callId: null })

			const [row] = await sql<{ action: string; outcome: string; revision_id: string; body_sha256: string }[]>`
				SELECT c.action, s.outcome, s.revision_id, c.body_sha256
				FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.action = 'revisions.bodyTokenAt'`
			expect(row).toEqual({
				action: "revisions.bodyTokenAt",
				outcome: "served",
				revision_id: pending!.id,
				body_sha256: "sha-draft",
			})
		})
	})

	it("refuses a Viewer a Revision other than the one the boundary serves them", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const serve = buildServeService(sql)
			const grants = new GrantsUsecase(new GrantsRepository(sql), serve, new RevisionsRepository(sql))
			const usecase = new RevisionBodyUsecase(
				serve,
				SECRET,
				"https://uc.exagram.test",
				300,
				new RevisionsRepository(sql),
			)
			await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "view" })

			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, fx.revisionOneId),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.bodyTokenAt({ id: fx.outsiderId, workspaceId: fx.workspaceId }, fx.artifactId, fx.revisionTwoId),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})
})

describe("RevisionBodyUsecase.bodyTokenAt (integration)", () => {
	const tokenOf = (url: string) => url.replace("https://uc.exagram.test/uc/", "")

	// v1 and v2 approved (v2 Current), v3 the Owner's Pending Revision.
	const seed = async (sql: Sql) => {
		const fx = await seedSharing(sql)
		const serve = buildServeService(sql)
		const grants = new GrantsUsecase(new GrantsRepository(sql), serve, new RevisionsRepository(sql))
		const usecase = new RevisionBodyUsecase(serve, SECRET, "https://uc.exagram.test", 300, new RevisionsRepository(sql))
		const pendingId = randomUUID()
		await sql`INSERT INTO exagram.revisions (id, artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
			VALUES (${pendingId}, ${fx.artifactId}, 3, ${fx.ownerId}, 'artifacts/v3.md', 'text/markdown', 11, 'sha-v3')`
		return { fx, grants, usecase, pendingId }
	}

	it("mints the Owner a token for a Pending Revision and ledgers that Revision's read", async () => {
		await withDb(async (sql) => {
			const { fx, usecase, pendingId } = await seed(sql)

			const minted = await usecase.bodyTokenAt(
				{ id: fx.ownerId, workspaceId: fx.workspaceId },
				fx.artifactId,
				pendingId,
			)
			expect(minted.revisionId).toBe(pendingId)
			expect(verifyUsercontentToken(tokenOf(minted.url), SECRET)).toEqual({
				ok: true,
				revisionId: pendingId,
				callId: null,
			})

			const [row] = await sql<{ action: string; outcome: string; revision_id: string; body_sha256: string }[]>`
				SELECT c.action, s.outcome, s.revision_id, c.body_sha256
				FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${fx.ownerId}`
			expect(row).toEqual({
				action: "revisions.bodyTokenAt",
				outcome: "served",
				revision_id: pendingId,
				body_sha256: "sha-v3",
			})
		})
	})

	it("mints the Owner a token for an Artifact whose only Revision is pending", async () => {
		await withDb(async (sql) => {
			const { fx, usecase } = await seed(sql)
			const [fresh] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.projectId}, 'html', 'Nothing yet')
				RETURNING id`
			const onlyId = randomUUID()
			await sql`INSERT INTO exagram.revisions (id, artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${onlyId}, ${fresh!.id}, 1, ${fx.ownerId}, 'artifacts/only.html', 'text/html', 11, 'sha-only')`

			await expect(
				usecase.bodyTokenAt({ id: fx.ownerId, workspaceId: fx.workspaceId }, fresh!.id, onlyId),
			).resolves.toMatchObject({
				revisionId: onlyId,
			})
		})
	})

	it("mints an author their own Pending Revision and refuses them the Owner's", async () => {
		await withDb(async (sql) => {
			const { fx, grants, usecase, pendingId } = await seed(sql)
			await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "edit" })
			const ownId = randomUUID()
			await sql`INSERT INTO exagram.revisions (id, artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
				VALUES (${ownId}, ${fx.artifactId}, 4, ${fx.granteeId}, 'artifacts/v4.md', 'text/markdown', 11, 'sha-v4')`

			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, ownId),
			).resolves.toMatchObject({
				revisionId: ownId,
			})
			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, pendingId),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, fx.revisionOneId),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("refuses a viewer someone else's Pending Revision and records no Revision on the withheld row", async () => {
		await withDb(async (sql) => {
			const { fx, grants, usecase, pendingId } = await seed(sql)
			await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "view" })

			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, pendingId),
			).rejects.toThrow(REFUSAL_TEXT)

			const [row] = await sql<{ outcome: string; reason: string; revision_id: string | null }[]>`
				SELECT s.outcome, s.reason, s.revision_id
				FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
				WHERE c.principal_id = ${fx.granteeId}`
			expect(row).toEqual({ outcome: "withheld", reason: "refused-in-serve", revision_id: null })
		})
	})

	it("serves a grantee the Revision the boundary resolved", async () => {
		await withDb(async (sql) => {
			const { fx, grants, usecase } = await seed(sql)
			await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "view" })

			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, fx.revisionTwoId),
			).resolves.toMatchObject({
				revisionId: fx.revisionTwoId,
			})
		})
	})

	it("serves a pinned grantee their pinned Revision and refuses them the Current one", async () => {
		await withDb(async (sql) => {
			const { fx, grants, usecase } = await seed(sql)
			const grant = await grants.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			await grants.updatePin(fx.ownerId, grant.id, fx.revisionOneId)

			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, fx.revisionOneId),
			).resolves.toMatchObject({
				revisionId: fx.revisionOneId,
			})
			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, fx.revisionTwoId),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("refuses an author their own discarded Revision", async () => {
		await withDb(async (sql) => {
			const { fx, grants, usecase } = await seed(sql)
			await grants.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "edit" })
			const discardedId = randomUUID()
			await sql`INSERT INTO exagram.revisions (id, artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256, status)
				VALUES (${discardedId}, ${fx.artifactId}, 4, ${fx.granteeId}, 'artifacts/v4.md', 'text/markdown', 11, 'sha-v4', 'discarded')`

			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, discardedId),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("refuses a Collaborator someone else's Pending Revision", async () => {
		await withDb(async (sql) => {
			const { fx, grants, usecase, pendingId } = await seed(sql)
			await grants.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "collaborate",
			})

			await expect(
				usecase.bodyTokenAt({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId, pendingId),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("refuses a Revision of another Artifact and a stranger, as it refuses a missing one", async () => {
		await withDb(async (sql) => {
			const { fx, usecase, pendingId } = await seed(sql)
			const [other] = await sql<{ id: string }[]>`
				INSERT INTO exagram.artifacts (workspace_id, owner_id, project_id, kind, title)
				VALUES (${fx.workspaceId}, ${fx.ownerId}, ${fx.projectId}, 'doc', 'Elsewhere')
				RETURNING id`

			await expect(
				usecase.bodyTokenAt({ id: fx.ownerId, workspaceId: fx.workspaceId }, other!.id, pendingId),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.bodyTokenAt({ id: fx.ownerId, workspaceId: fx.workspaceId }, fx.artifactId, randomUUID()),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.bodyTokenAt({ id: fx.outsiderId, workspaceId: fx.workspaceId }, fx.artifactId, pendingId),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})
})

describe("RevisionPreviewUsecase (integration)", () => {
	it("mints a pinned reader's preview token for exact cached HTML and ledgers its digest", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await sql`UPDATE exagram.artifacts SET kind = 'pdf' WHERE id = ${fx.artifactId}`
			const htmlOne = "<p>first preview</p>"
			const htmlTwo = "<p>second preview</p>"
			await sql`
				INSERT INTO exagram.revision_previews (revision_id, html)
				VALUES (${fx.revisionOneId}, ${htmlOne}), (${fx.revisionTwoId}, ${htmlTwo})
			`
			const serve = buildServeService(sql)
			const grants = new GrantsUsecase(new GrantsRepository(sql), serve, new RevisionsRepository(sql))
			const usecase = new RevisionPreviewUsecase(serve, SECRET, "https://uc.exagram.test", 300)
			const grant = await grants.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			await grants.updatePin(fx.ownerId, grant.id, fx.revisionOneId)

			const minted = await usecase.previewToken({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId)
			const digest = createHash("sha256").update(htmlOne).digest("hex")
			expect(minted.revisionId).toBe(fx.revisionOneId)
			expect(minted.url).toMatch(/^https:\/\/uc\.exagram\.test\/uc\/[^/]+\/preview$/)
			const token = minted.url!.replace("https://uc.exagram.test/uc/", "").replace("/preview", "")
			expect(verifyUsercontentToken(token, SECRET)).toEqual({
				ok: true,
				revisionId: fx.revisionOneId,
				callId: null,
				previewSha256: digest,
			})
			const [row] = await sql<{ action: string; body_sha256: string }[]>`
				SELECT action, body_sha256 FROM exagram.ledger_calls
				WHERE principal_id = ${fx.granteeId} AND action = 'revisions.previewToken'
			`
			expect(row).toEqual({ action: "revisions.previewToken", body_sha256: digest })
			await expect(
				usecase.previewToken({ id: fx.outsiderId, workspaceId: fx.workspaceId }, fx.artifactId),
			).rejects.toThrow(REFUSAL_TEXT)
			await sql`DELETE FROM exagram.revision_previews WHERE revision_id = ${fx.revisionOneId}`
			expect(await usecase.previewToken({ id: fx.granteeId, workspaceId: fx.workspaceId }, fx.artifactId)).toEqual({
				revisionId: fx.revisionOneId,
				url: null,
				expiresInSeconds: 300,
			})
		})
	})
})
