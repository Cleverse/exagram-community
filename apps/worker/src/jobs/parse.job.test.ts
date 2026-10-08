import {
	getRevisionForParse,
	markExtractionDone,
	markExtractionFailed,
} from "@exagram/core/repository/postgres/gen/exagram_parse_sql"
import { InMemoryObjectStore } from "@exagram/core/services/object-store.service"
import { sha256Hex } from "@exagram/core/utils/digest"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createParseJobHandler } from "./parse.job"

import type { Sql } from "postgres"

vi.mock("@exagram/core/repository/postgres/gen/exagram_parse_sql", () => ({
	getRevisionForParse: vi.fn(),
	markExtractionDone: vi.fn(),
	markExtractionFailed: vi.fn(),
}))

const sql = {} as Sql
const body = new TextEncoder().encode("recorded bytes")

describe("parse job", () => {
	let objectStore: InMemoryObjectStore
	const parse = vi.fn(() => Promise.resolve({ text: "parsed", pages: 1 }))
	const enqueueRedact = vi.fn(() => Promise.resolve())

	beforeEach(async () => {
		vi.clearAllMocks()
		objectStore = new InMemoryObjectStore({})
		await objectStore.put({ key: "artifacts/a/1", bytes: body, mime: "application/pdf" })
		vi.mocked(getRevisionForParse).mockResolvedValue({
			id: "r1",
			storageKey: "artifacts/a/1",
			mime: "application/pdf",
			sha256: sha256Hex(Buffer.from(body)),
			extractionStatus: "queued",
			kind: "pdf",
		})
	})

	const run = () => createParseJobHandler({ sql, objectStore, parser: { parse }, enqueueRedact })({ revisionId: "r1" })

	it("parses bytes that match the Revision's digest", async () => {
		await run()

		expect(parse).toHaveBeenCalledOnce()
		expect(markExtractionDone).toHaveBeenCalledWith(sql, { revisionId: "r1", extractedText: "parsed" })
		expect(enqueueRedact).toHaveBeenCalledWith("r1")
	})

	it("fails the extraction without parsing or queueing redaction when the stored bytes changed", async () => {
		await objectStore.put({
			key: "artifacts/a/1",
			bytes: new TextEncoder().encode("other bytes"),
			mime: "application/pdf",
		})

		await run()

		expect(parse).not.toHaveBeenCalled()
		expect(markExtractionFailed).toHaveBeenCalledWith(sql, {
			revisionId: "r1",
			extractionError: "Stored bytes don't match the Revision.",
		})
		expect(markExtractionDone).not.toHaveBeenCalled()
		expect(enqueueRedact).not.toHaveBeenCalled()
	})
})
