import { describe, expect, it, vi } from "vitest"

import { queueUploadProcessing } from "./mcp.plugin"

const jobs = () => ({
	enqueueParse: vi.fn().mockResolvedValue(undefined),
	enqueueRedact: vi.fn().mockResolvedValue(undefined),
})

describe("queueUploadProcessing", () => {
	it("queues parse and redaction for a fresh pdf", async () => {
		const queue = jobs()
		await queueUploadProcessing(
			queue,
			{ revisionId: "r1", kind: "pdf", extractionStatus: "queued", repeated: false },
			vi.fn(),
		)
		expect(queue.enqueueParse).toHaveBeenCalledWith("r1")
		expect(queue.enqueueRedact).toHaveBeenCalledWith("r1")
	})

	it("queues only redaction for a fresh doc, whose text was inlined", async () => {
		const queue = jobs()
		await queueUploadProcessing(
			queue,
			{ revisionId: "r1", kind: "doc", extractionStatus: "done", repeated: false },
			vi.fn(),
		)
		expect(queue.enqueueParse).not.toHaveBeenCalled()
		expect(queue.enqueueRedact).toHaveBeenCalledWith("r1")
	})

	it("queues nothing for a repeat on a done Revision, so its Redacted Text is not reset", async () => {
		for (const kind of ["pdf", "doc"]) {
			const queue = jobs()
			await queueUploadProcessing(queue, { revisionId: "r1", kind, extractionStatus: "done", repeated: true }, vi.fn())
			expect(queue.enqueueParse).not.toHaveBeenCalled()
			expect(queue.enqueueRedact).not.toHaveBeenCalled()
		}
	})

	it("re-sends only a parse still queued on a repeat", async () => {
		const queue = jobs()
		await queueUploadProcessing(
			queue,
			{ revisionId: "r1", kind: "xlsx", extractionStatus: "queued", repeated: true },
			vi.fn(),
		)
		expect(queue.enqueueParse).toHaveBeenCalledWith("r1")
		expect(queue.enqueueRedact).not.toHaveBeenCalled()
	})

	it("asks for a retry only when the parse could not be queued, and reports each failure", async () => {
		const failing = (fail: { parse?: boolean; redact?: boolean }) => ({
			enqueueParse: fail.parse ? vi.fn().mockRejectedValue(new Error("parse")) : vi.fn().mockResolvedValue(undefined),
			enqueueRedact: fail.redact
				? vi.fn().mockRejectedValue(new Error("redact"))
				: vi.fn().mockResolvedValue(undefined),
		})
		const fresh = { revisionId: "r1", kind: "pdf", extractionStatus: "queued", repeated: false }

		const both = failing({ parse: true, redact: true })
		const reportBoth = vi.fn()
		await expect(queueUploadProcessing(both, fresh, reportBoth)).resolves.toBe("parse-not-queued")
		expect(both.enqueueRedact).toHaveBeenCalledWith("r1")
		expect(reportBoth).toHaveBeenCalledTimes(2)

		const report = vi.fn()
		await expect(queueUploadProcessing(failing({ redact: true }), fresh, report)).resolves.toBe("redaction-not-queued")
		expect(report).toHaveBeenCalledTimes(1)

		await expect(queueUploadProcessing(failing({}), fresh, vi.fn())).resolves.toBeUndefined()
		await expect(
			queueUploadProcessing(
				failing({ parse: true, redact: true }),
				{ ...fresh, extractionStatus: "done", repeated: true },
				vi.fn(),
			),
		).resolves.toBeUndefined()
	})
})
