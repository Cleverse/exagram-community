import { Readable } from "node:stream"

import { enqueueRedactionForRevision } from "@exagram/core/repository/postgres/gen/exagram_redaction_sql"
import { withDb } from "@exagram/core/test/pg"
import { sha256Hex } from "@exagram/core/utils/digest"
import { describe, expect, it } from "vitest"

import type { ObjectStore } from "@exagram/core/services/object-store.service"
import type { Parser } from "@exagram/parser"

import { createParseJobHandler } from "./parse.job"

import type { Sql } from "postgres"

const store = (bytes: Uint8Array): ObjectStore => ({
	get: () => Promise.resolve(bytes),
	put: () => Promise.resolve(undefined),
	getStream: () => Promise.resolve({ stream: Readable.from([Buffer.from(bytes)]), contentLength: bytes.byteLength }),
	getText: () => Promise.resolve(Buffer.from(bytes).toString("utf8")),
	head: () => Promise.resolve(null),
	delete: () => Promise.resolve(),
})

const parserReturning = (text: string): Parser => ({ parse: () => Promise.resolve({ text, pages: 1 }) })
const parserThrowing = (message: string): Parser => ({
	parse: () => Promise.reject(new Error(message)),
})

const storeFailingGet = (message: string): ObjectStore => ({
	get: () => Promise.reject(new Error(message)),
	put: () => Promise.resolve(undefined),
	getStream: () => Promise.reject(new Error(message)),
	getText: () => Promise.reject(new Error(message)),
	head: () => Promise.resolve(null),
	delete: () => Promise.resolve(),
})

const BODY = new Uint8Array([1, 2, 3])

/** Minimal owner + artifact + queued revision; returns the revision id. */
async function seedQueuedRevision(sql: Sql, body: Uint8Array = BODY): Promise<string> {
	const [workspace] = await sql<{ id: string }[]>`insert into exagram.workspaces (name) values ('W') returning id`
	const [user] = await sql<{ id: string }[]>`
		insert into exagram.users (email, name, password_hash) values ('a@example.com', 'A', 'x') returning id`
	const [artifact] = await sql<{ id: string }[]>`
		insert into exagram.artifacts (workspace_id, owner_id, kind, title)
		values (${workspace!.id}, ${user!.id}, 'pdf', 'Report') returning id`
	const [revision] = await sql<{ id: string }[]>`
		insert into exagram.revisions
			(artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256, extraction_status)
		values (${artifact!.id}, 1, ${user!.id}, 'bodies/abc', 'application/pdf', ${body.byteLength}, ${sha256Hex(Buffer.from(body))}, 'queued')
		returning id`
	return revision!.id
}

describe("parse job", () => {
	it("stores the extracted text and marks the revision done", async () => {
		await withDb(async (sql) => {
			const revisionId = await seedQueuedRevision(sql)
			const handler = createParseJobHandler({
				sql,
				objectStore: store(BODY),
				parser: parserReturning("<!-- Page: 1 -->\nHello"),
				enqueueRedact: () => Promise.resolve(),
			})

			await handler({ revisionId })

			const [row] = await sql`
				select extracted_text, extraction_status, extraction_error
				from exagram.revisions where id = ${revisionId}`
			expect(row!.extraction_status).toBe("done")
			expect(row!.extracted_text).toBe("<!-- Page: 1 -->\nHello")
			expect(row!.extraction_error).toBeNull()
		})
	})

	it("records the message and marks the revision failed", async () => {
		await withDb(async (sql) => {
			const revisionId = await seedQueuedRevision(sql)
			const handler = createParseJobHandler({
				sql,
				objectStore: store(BODY),
				parser: parserThrowing("corrupt xref table"),
				enqueueRedact: () => Promise.resolve(),
			})

			await handler({ revisionId })

			const [row] = await sql`
				select extracted_text, extraction_status, extraction_error
				from exagram.revisions where id = ${revisionId}`
			expect(row!.extraction_status).toBe("failed")
			expect(row!.extraction_error).toBe("corrupt xref table")
			expect(row!.extracted_text).toBeNull()
		})
	})

	it("marks the revision failed, and queues no redaction, when the stored bytes aren't the Revision's", async () => {
		await withDb(async (sql) => {
			const revisionId = await seedQueuedRevision(sql)
			const redacts: string[] = []
			const handler = createParseJobHandler({
				sql,
				objectStore: store(new Uint8Array([9, 9, 9])),
				parser: parserReturning("from the overwritten bytes"),
				enqueueRedact: (id) => {
					redacts.push(id)
					return Promise.resolve()
				},
			})

			await handler({ revisionId })

			const [row] = await sql`
				select extracted_text, extraction_status, extraction_error
				from exagram.revisions where id = ${revisionId}`
			expect(row!.extraction_status).toBe("failed")
			expect(row!.extraction_error).toBe("Stored bytes don't match the Revision.")
			expect(row!.extracted_text).toBeNull()
			expect(redacts).toEqual([])
		})
	})

	it("rethrows when the object store fails, and leaves the revision queued for pg-boss to retry", async () => {
		await withDb(async (sql) => {
			const revisionId = await seedQueuedRevision(sql)
			const handler = createParseJobHandler({
				sql,
				objectStore: storeFailingGet("connection reset"),
				parser: parserReturning("unreachable"),
				enqueueRedact: () => Promise.resolve(),
			})

			await expect(handler({ revisionId })).rejects.toThrow("connection reset")

			const [row] = await sql`
				select extracted_text, extraction_status, extraction_error
				from exagram.revisions where id = ${revisionId}`
			expect(row!.extraction_status).toBe("queued")
			expect(row!.extraction_error).toBeNull()
			expect(row!.extracted_text).toBeNull()
		})
	})

	it("leaves an already-extracted revision alone when the job is redelivered", async () => {
		await withDb(async (sql) => {
			const revisionId = await seedQueuedRevision(sql)
			await sql`
				update exagram.revisions
				set extraction_status = 'done', extracted_text = 'first pass'
				where id = ${revisionId}`
			const handler = createParseJobHandler({
				sql,
				objectStore: store(BODY),
				parser: parserReturning("second pass"),
				enqueueRedact: () => Promise.resolve(),
			})

			await handler({ revisionId })

			const [row] = await sql`select extracted_text from exagram.revisions where id = ${revisionId}`
			expect(row!.extracted_text).toBe("first pass")
		})
	})

	it("leaves the Revision queued for redaction when extraction finishes", async () => {
		await withDb(async (sql) => {
			const revisionId = await seedQueuedRevision(sql)
			await sql`
				UPDATE exagram.revisions
				SET redaction_status = 'done', redacted_text = 'stale', redaction_detector_version = 1
				WHERE id = ${revisionId}`

			await createParseJobHandler({
				sql,
				objectStore: store(BODY),
				parser: parserReturning("fresh text"),
				enqueueRedact: (id) => enqueueRedactionForRevision(sql, { revisionId: id }),
			})({ revisionId })

			const [row] = await sql<{ redaction_status: string; redacted_text: string | null }[]>`
				SELECT redaction_status, redacted_text FROM exagram.revisions WHERE id = ${revisionId}
			`
			expect(row!.redaction_status).toBe("queued")
			expect(row!.redacted_text).toBeNull()
		})
	})
})
