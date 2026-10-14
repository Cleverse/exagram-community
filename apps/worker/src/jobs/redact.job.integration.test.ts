import { randomUUID } from "node:crypto"

import { enqueueRedactionForRevision } from "@exagram/core/repository/postgres/gen/exagram_redaction_sql"
import { withDb } from "@exagram/core/test/pg"
import { seedArtifact, seedProject, seedRevision, seedUser, seedWorkspace } from "@exagram/core/test/seed"
import { nullDetector, REDACTION_LIMIT_BYTES, type Detector } from "@exagram/redactor"
import { describe, expect, it } from "vitest"

import type { ArtifactKind } from "@exagram/core/test/seed"

import { BODY_MISMATCH_ERROR } from "../served-text"

import { createRedactJobHandler } from "./redact.job"

import type { Sql } from "postgres"

const seedBody = async (
	sql: Sql,
	options: {
		kind: ArtifactKind
		extractedText?: string | null
		extractionStatus?: string
		extractionError?: string
	},
) => {
	const workspaceId = await seedWorkspace(sql)
	const ownerId = await seedUser(sql, { workspaceId, email: `${randomUUID()}@worker.test` })
	const projectId = await seedProject(sql, { workspaceId, ownerId, name: "p" })
	const artifactId = await seedArtifact(sql, { workspaceId, ownerId, projectId, title: "a", kind: options.kind })
	const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
	if (
		options.extractedText !== undefined ||
		options.extractionStatus !== undefined ||
		options.extractionError !== undefined
	) {
		await sql`
			UPDATE "exagram"."revisions"
			SET extracted_text = ${options.extractedText ?? null}, extraction_status = ${options.extractionStatus ?? "none"},
				extraction_error = ${options.extractionError ?? null}
			WHERE id = ${revisionId}
		`
	}
	await enqueueRedactionForRevision(sql, { revisionId })
	return { revisionId }
}

const readRow = async (sql: Sql, revisionId: string) => {
	const [row] = await sql<
		{
			redacted_text: string | null
			redaction_status: string
			redaction_detector_version: number | null
			redaction_input_sha256: string | null
			placeholder_types: string[]
		}[]
	>`
		SELECT redacted_text, redaction_status, redaction_detector_version, redaction_input_sha256, placeholder_types
		FROM "exagram"."revisions" WHERE id = ${revisionId}
	`
	return row!
}

describe("redact job (integration)", () => {
	/** The kept cases need one finding type, not a full detector. */
	const emailOnly: Detector = {
		version: 1,
		detect: (text) =>
			[...text.matchAll(/[^\s@[\]]+@[^\s@[\]]+\.[a-z]+/g)].map((m) => ({
				type: "EMAIL" as const,
				start: m.index,
				end: m.index + m[0].length,
			})),
	}

	const handler = (
		sql: Sql,
		body: string,
		read: () => Promise<string | null> = () => Promise.resolve(body),
		detector: Detector = emailOnly,
	) => createRedactJobHandler({ sql, objectStore: { read }, detector })

	it("stores Redacted Text, the detector version, the input hash and the placeholder types", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			await handler(sql, "Mail jane@example.com now")({ revisionId: fx.revisionId })

			const row = await readRow(sql, fx.revisionId)
			expect(row.redacted_text).toBe("Mail [EMAIL] now")
			expect(row.redaction_status).toBe("done")
			expect(row.redaction_detector_version).toBe(emailOnly.version)
			expect(row.redaction_input_sha256).toHaveLength(64)
			expect(row.placeholder_types).toEqual(["EMAIL"])
		})
	})

	it("records the placeholder types a body already carried", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			await handler(sql, "The template reads [EMAIL] and [PHONE].")({ revisionId: fx.revisionId })
			expect((await readRow(sql, fx.revisionId)).placeholder_types).toEqual(["EMAIL", "PHONE"])
		})
	})

	it("redacts the Extracted Text for an extracted kind, not the stored object", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "pdf", extractedText: "page: jane@example.com", extractionStatus: "done" })
			await handler(sql, "THE RAW PDF BYTES")({ revisionId: fx.revisionId })
			expect((await readRow(sql, fx.revisionId)).redacted_text).toBe("page: [EMAIL]")
		})
	})

	it("never reads image bytes as text and clears an already queued image", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "image" })
			expect((await readRow(sql, fx.revisionId)).redaction_status).toBe("none")
			await sql`UPDATE "exagram"."revisions" SET redaction_status = 'queued', redaction_queued_at = now() WHERE id = ${fx.revisionId}`
			await handler(sql, "", () => {
				throw new Error("image bytes must not be read as text")
			})({ revisionId: fx.revisionId })
			const row = await readRow(sql, fx.revisionId)
			expect(row.redaction_status).toBe("none")
			expect(row.redacted_text).toBeNull()
		})
	})

	it("marks a body over the limit too_large and stores no text", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			await handler(sql, "x".repeat(5 * 1024 * 1024 + 1))({ revisionId: fx.revisionId })

			const row = await readRow(sql, fx.revisionId)
			expect(row.redaction_status).toBe("too_large")
			expect(row.redacted_text).toBeNull()
		})
	})

	it("withholds an oversized inline HTML body without storing a partial redaction", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "html" })
			const body = `<main>${"x".repeat(5 * 1024 * 1024)}secret@example.test</main>`
			let reads = 0
			await handler(sql, body, () => {
				reads += 1
				return Promise.resolve(body)
			})({ revisionId: fx.revisionId })

			const row = await readRow(sql, fx.revisionId)
			expect(reads).toBe(1)
			expect(row.redaction_status).toBe("too_large")
			expect(row.redacted_text).toBeNull()
			expect(row.redaction_detector_version).toBeNull()
			expect(row.redaction_input_sha256).toBeNull()
		})
	})

	it("marks an extracted kind whose extraction failed as failed", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "pdf", extractionStatus: "failed" })
			await handler(sql, "")({ revisionId: fx.revisionId })
			expect((await readRow(sql, fx.revisionId)).redaction_status).toBe("failed")
		})
	})

	it("marks a body whose stored bytes aren't the Revision's as failed and stores no text", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			await handler(sql, "", () => Promise.resolve(null))({ revisionId: fx.revisionId })

			const row = await readRow(sql, fx.revisionId)
			expect(row.redaction_status).toBe("failed")
			expect(row.redacted_text).toBeNull()
			const [error] = await sql<{ redaction_error: string | null }[]>`
				SELECT redaction_error FROM "exagram"."revisions" WHERE id = ${fx.revisionId}
			`
			expect(error!.redaction_error).toBe("Stored bytes don't match the Revision.")
		})
	})

	it("stores the parser-failure message for a parse-found digest mismatch, as before editions", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "pdf", extractionStatus: "failed", extractionError: BODY_MISMATCH_ERROR })
			await handler(sql, "")({ revisionId: fx.revisionId })
			const [row] = await sql<{ redaction_status: string; redaction_error: string | null }[]>`
				SELECT redaction_status, redaction_error FROM "exagram"."revisions" WHERE id = ${fx.revisionId}
			`
			expect(row!.redaction_status).toBe("failed")
			expect(row!.redaction_error).toBe("No Extracted Text: the parser failed for this Revision.")
		})
	})

	it("leaves an extracted kind still waiting on its parser queued", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "pdf", extractionStatus: "queued" })
			await handler(sql, "")({ revisionId: fx.revisionId })
			expect((await readRow(sql, fx.revisionId)).redaction_status).toBe("queued")
		})
	})

	it("is idempotent: running twice leaves the same row", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			const run = handler(sql, "Mail jane@example.com now")
			await run({ revisionId: fx.revisionId })
			const first = await readRow(sql, fx.revisionId)
			await run({ revisionId: fx.revisionId })
			expect(await readRow(sql, fx.revisionId)).toEqual(first)
		})
	})

	it("drops a result when the Revision is reset between read and store", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			const run = handler(sql, "Mail jane@example.com now", async () => {
				await enqueueRedactionForRevision(sql, { revisionId: fx.revisionId })
				return "Mail jane@example.com now"
			})

			await run({ revisionId: fx.revisionId })

			const row = await readRow(sql, fx.revisionId)
			expect(row.redaction_status).toBe("queued")
			expect(row.redacted_text).toBeNull()
		})
	})

	it("does nothing for a Revision whose redaction is already done", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			const run = handler(sql, "Mail jane@example.com now")
			await run({ revisionId: fx.revisionId })
			const first = await readRow(sql, fx.revisionId)

			await run({ revisionId: fx.revisionId })

			expect(await readRow(sql, fx.revisionId)).toEqual(first)
		})
	})

	it("does nothing for a Revision that no longer exists", async () => {
		await withDb(async (sql) => {
			await expect(handler(sql, "")({ revisionId: "3fa85f64-5717-4562-b3fc-2c963f66afa6" })).resolves.toBeUndefined()
		})
	})

	it("with the null detector: done, version 0, empty Redacted Text, the author's placeholder types", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			await handler(sql, "Mail jane@example.com now [EMAIL]", undefined, nullDetector)({ revisionId: fx.revisionId })
			expect(await readRow(sql, fx.revisionId)).toMatchObject({
				redaction_status: "done",
				redaction_detector_version: 0,
				redacted_text: "",
				placeholder_types: ["EMAIL"],
			})
		})
	})

	it("with the null detector, a body over REDACTION_LIMIT_BYTES is still done (approval must not block)", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			await handler(sql, "x".repeat(REDACTION_LIMIT_BYTES + 1), undefined, nullDetector)({ revisionId: fx.revisionId })
			expect((await readRow(sql, fx.revisionId)).redaction_status).toBe("done")
		})
	})

	it("with the null detector, a failed parse is done", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "pdf", extractionStatus: "failed" })
			await handler(sql, "", undefined, nullDetector)({ revisionId: fx.revisionId })
			expect((await readRow(sql, fx.revisionId)).redaction_status).toBe("done")
		})
	})

	it("with the null detector, a body mismatch still fails", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "doc" })
			await handler(sql, "", () => Promise.resolve(null), nullDetector)({ revisionId: fx.revisionId })
			expect((await readRow(sql, fx.revisionId)).redaction_status).toBe("failed")
		})
	})

	it("with the null detector, a mismatch the parse job found still fails", async () => {
		await withDb(async (sql) => {
			const fx = await seedBody(sql, { kind: "pdf", extractionStatus: "failed", extractionError: BODY_MISMATCH_ERROR })
			await handler(sql, "", undefined, nullDetector)({ revisionId: fx.revisionId })
			expect((await readRow(sql, fx.revisionId)).redaction_status).toBe("failed")
		})
	})
})
