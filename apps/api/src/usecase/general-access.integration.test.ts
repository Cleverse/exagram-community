import { createHash, randomUUID } from "node:crypto"

import { anonymousReader } from "@exagram/core/entity/principal"
import { ArtifactsRepository } from "@exagram/core/repository/postgres/artifacts.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { ProjectsRepository } from "@exagram/core/repository/postgres/projects.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { verifyUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { withDb } from "@exagram/core/test/pg"
import { seedGrant } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import type { User } from "@exagram/core/entity/auth"

import { noArtifactRedaction } from "./artifacts/artifact-redaction.port"
import { ArtifactsUsecase } from "./artifacts/artifacts.usecase"
import { RevisionBodyUsecase } from "./revision-body.usecase"
import { RevisionsUsecase } from "./revisions/revisions.usecase"
import { FakeJobQueue, FakeObjectStorage } from "./store.datagateway.fake"

import type { Sql } from "postgres"

const user = (id: string, workspaceId: string): User => ({
	id,
	workspaceId,
	email: "reader@example.com",
	name: "Reader",
	isAdmin: false,
	googleLinked: true,
	createdAt: new Date(),
})

const SECRET = "s".repeat(32)

const build = (sql: Sql) => {
	const artifactsRepo = new ArtifactsRepository(sql)
	const serve = buildServeService(sql)
	const storage = new FakeObjectStorage()
	const revisions = new RevisionsUsecase(
		artifactsRepo,
		new RevisionsRepository(sql),
		storage,
		serve,
		new TransactionProvider(sql),
		{ maxBytes: 20971520, recheckBeforeFinalize: true },
		new FakeJobQueue(),
	)
	return {
		storage,
		revisions,
		ledger: new LedgerRepository(sql),
		artifacts: new ArtifactsUsecase(artifactsRepo, new ProjectsRepository(sql), revisions, serve, noArtifactRedaction, [
			"restricted",
			"org",
			"anyone",
		]),
		body: new RevisionBodyUsecase(serve, SECRET, "https://uc.exagram.test", 300, new RevisionsRepository(sql)),
	}
}

type LedgerRow = { principal_kind: string; principal_id: string; surface: string; action: string; outcome: string }

const ledgerRows = (sql: Sql, artifactId: string) =>
	sql<LedgerRow[]>`
		SELECT c.principal_kind, c.principal_id, c.surface, c.action, s.outcome
		FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
		WHERE s.artifact_id = ${artifactId}::uuid
		ORDER BY c.started_at`

const refusalOf = async (read: Promise<unknown>): Promise<{ name: string; message: string }> => {
	try {
		await read
	} catch (error) {
		if (error instanceof Error) return { name: error.name, message: error.message }
		throw error
	}
	throw new Error("expected a refusal")
}

describe("general access API (integration)", () => {
	it("gets an org artifact without a guest list and mints its body token", () =>
		withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await seedGrant(sql, { artifactId: fx.artifactId, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${fx.workspaceId}, 'acme.test')`
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${fx.outsiderId}, 'google', 'outsider-google', 'outsider@acme.test')`
			await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${fx.artifactId}`
			const { artifacts, body } = build(sql)
			const opened = await artifacts.get(
				{ kind: "user", id: fx.outsiderId, workspaceId: fx.workspaceId },
				fx.artifactId,
			)
			expect(opened).toMatchObject({
				access: "view",
				generalAccess: "org",
				sharedCount: 0,
				sharedWithNames: [],
				orgDomain: null,
			})
			expect(
				await artifacts.get({ kind: "user", id: fx.ownerId, workspaceId: fx.workspaceId }, fx.artifactId),
			).toMatchObject({
				orgDomain: "acme.test",
			})
			expect(
				(await body.bodyToken({ kind: "user", id: fx.outsiderId, workspaceId: fx.workspaceId }, fx.artifactId))
					.revisionId,
			).toBe(fx.revisionTwoId)
		}))

	it("allows only the owner to toggle, and requires an org domain to enable org", () =>
		withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { artifacts } = build(sql)
			const owner = user(fx.ownerId, fx.workspaceId)
			const reader = user(fx.outsiderId, fx.workspaceId)
			await expect(
				artifacts.setGeneralAccess(owner, {
					artifactId: fx.artifactId,
					generalAccess: "org",
				}),
			).rejects.toThrow("This Workspace has no Allowed Domain.")
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${fx.workspaceId}, 'acme.test')`
			await expect(
				artifacts.setGeneralAccess(reader, {
					artifactId: fx.artifactId,
					generalAccess: "org",
				}),
			).rejects.toThrow(REFUSAL_TEXT)
			expect(
				await artifacts.setGeneralAccess(owner, {
					artifactId: fx.artifactId,
					generalAccess: "org",
				}),
			).toMatchObject({ generalAccess: "org" })
			expect(
				await artifacts.setGeneralAccess(owner, {
					artifactId: fx.artifactId,
					generalAccess: "restricted",
				}),
			).toMatchObject({ generalAccess: "restricted" })
		}))
})

describe("anyone with the link API (integration)", () => {
	it("lets the Owner open a file to anyone without an Allowed Domain, and nobody else", () =>
		withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { artifacts } = build(sql)
			await expect(
				artifacts.setGeneralAccess(user(fx.outsiderId, fx.workspaceId), {
					artifactId: fx.artifactId,
					generalAccess: "anyone",
				}),
			).rejects.toThrow(REFUSAL_TEXT)
			expect(
				await artifacts.setGeneralAccess(user(fx.ownerId, fx.workspaceId), {
					artifactId: fx.artifactId,
					generalAccess: "anyone",
				}),
			).toMatchObject({ generalAccess: "anyone" })
		}))

	it("serves a signed-out get, text and body token, each ledgered as the anonymous reader", () =>
		withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { artifacts, body, revisions, storage, ledger } = build(sql)
			const text = "hello world"
			storage.seed("artifacts/v2.md", text)
			await sql`UPDATE exagram.revisions SET sha256 = ${createHash("sha256").update(text).digest("hex")}
				WHERE id = ${fx.revisionTwoId}`
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${fx.artifactId}`
			const reader = anonymousReader(fx.artifactId)

			const opened = await artifacts.get(reader, fx.artifactId)
			expect(opened).toMatchObject({
				access: "view",
				generalAccess: "anyone",
				visibleRevisionId: fx.revisionTwoId,
				sharedCount: 0,
				sharedWithNames: [],
				orgDomain: null,
				canDownload: true,
				anyoneSettings: null,
			})
			expect(opened.currentRevisionId).toBeUndefined()

			expect(await revisions.text(reader, fx.artifactId)).toMatchObject({ revisionId: fx.revisionTwoId, text })

			const minted = await body.bodyToken(reader, fx.artifactId)
			expect(minted.revisionId).toBe(fx.revisionTwoId)
			const token = verifyUsercontentToken(minted.url.replace("https://uc.exagram.test/uc/", ""), SECRET)

			const rows = await ledgerRows(sql, fx.artifactId)
			expect(rows).toEqual([
				{
					principal_kind: "anonymous",
					principal_id: fx.artifactId,
					surface: "web",
					action: "artifacts.get",
					outcome: "served",
				},
				{
					principal_kind: "anonymous",
					principal_id: fx.artifactId,
					surface: "web",
					action: "revisions.text",
					outcome: "served",
				},
				{
					principal_kind: "anonymous",
					principal_id: fx.artifactId,
					surface: "web",
					action: "revisions.bodyToken",
					outcome: "served",
				},
			])
			const [, , bodyCall] = await sql<{ id: string }[]>`
				SELECT c.id FROM exagram.ledger_calls c WHERE c.principal_kind = 'anonymous' ORDER BY c.started_at`
			expect(token.ok && token.callId).toBe(bodyCall?.id)
			// Viewers folds people; an anonymous open is in the Ledger and nowhere else.
			expect(await ledger.listArtifactViewers(fx.artifactId)).toEqual([])
		}))

	it("refuses a signed-out reader of a restricted file exactly as a missing one, and ledgers it", () =>
		withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const { artifacts, body, revisions } = build(sql)
			const missing = randomUUID()

			for (const read of [
				(id: string) => artifacts.get(anonymousReader(id), id),
				(id: string) => revisions.text(anonymousReader(id), id),
				(id: string) => body.bodyToken(anonymousReader(id), id),
			]) {
				const refused = await refusalOf(read(fx.artifactId))
				expect(refused.message).toBe(REFUSAL_TEXT)
				expect(await refusalOf(read(missing))).toEqual(refused)
			}
			await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${fx.artifactId}`
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${fx.workspaceId}, 'acme.test')`
			expect(await refusalOf(artifacts.get(anonymousReader(fx.artifactId), fx.artifactId))).toEqual(
				await refusalOf(artifacts.get(anonymousReader(missing), missing)),
			)

			const rows = await ledgerRows(sql, fx.artifactId)
			expect(rows).toHaveLength(4)
			expect(rows.every((row) => row.principal_kind === "anonymous" && row.outcome === "withheld")).toBe(true)
		}))
})
