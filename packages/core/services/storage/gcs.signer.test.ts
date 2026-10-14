import { describe, expect, it, vi } from "vitest"

import { GcsUploadSigner } from "./gcs.signer"

import type { Bucket, File } from "@google-cloud/storage"

describe("GcsUploadSigner.createUploadTicket", () => {
	it("signs a v4 write URL with content-length and range extension headers", async () => {
		const getSignedUrl = vi.fn().mockResolvedValue(["https://signed"])
		const file: Partial<File> = { getSignedUrl }
		const bucket = { file: vi.fn().mockReturnValue(file) } as unknown as Bucket
		const signer = new GcsUploadSigner(bucket, { ticketTtlSeconds: 300 })

		const ticket = await signer.createUploadTicket({
			storageKey: "artifacts/a/b",
			mime: "application/pdf",
			bytes: 1234,
		})

		expect(getSignedUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				version: "v4",
				action: "write",
				contentType: "application/pdf",
				extensionHeaders: {
					"content-length": "1234",
					"x-goog-content-length-range": "1234,1234",
				},
			}),
		)
		expect(ticket).toEqual({
			url: "https://signed",
			storageKey: "artifacts/a/b",
			expiresInSeconds: 300,
			requiredHeaders: {
				"content-type": "application/pdf",
				"content-length": "1234",
				"x-goog-content-length-range": "1234,1234",
			},
		})
	})

	it("signs x-goog-if-generation-match: 0 when the ticket input asks createOnly, config off", async () => {
		const getSignedUrl = vi.fn().mockResolvedValue(["https://signed"])
		const bucket = { file: vi.fn().mockReturnValue({ getSignedUrl }) } as unknown as Bucket
		const signer = new GcsUploadSigner(bucket, { ticketTtlSeconds: 300, createOnly: false })

		const asked = await signer.createUploadTicket({
			storageKey: "k",
			mime: "application/pdf",
			bytes: 5,
			createOnly: true,
		})
		const notAsked = await signer.createUploadTicket({ storageKey: "k", mime: "application/pdf", bytes: 5 })

		expect(asked.requiredHeaders).toMatchObject({ "x-goog-if-generation-match": "0" })
		expect(getSignedUrl).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				extensionHeaders: {
					"content-length": "5",
					"x-goog-content-length-range": "5,5",
					"x-goog-if-generation-match": "0",
				},
			}),
		)
		expect(notAsked.requiredHeaders).not.toHaveProperty("x-goog-if-generation-match")
	})

	it("also signs x-goog-if-generation-match: 0 when createOnly is set", async () => {
		const getSignedUrl = vi.fn().mockResolvedValue(["https://signed"])
		const bucket = { file: vi.fn().mockReturnValue({ getSignedUrl }) } as unknown as Bucket
		const signer = new GcsUploadSigner(bucket, { ticketTtlSeconds: 300, createOnly: true })

		const ticket = await signer.createUploadTicket({ storageKey: "k", mime: "application/pdf", bytes: 5 })

		expect(getSignedUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				extensionHeaders: {
					"content-length": "5",
					"x-goog-content-length-range": "5,5",
					"x-goog-if-generation-match": "0",
				},
			}),
		)
		expect(ticket.requiredHeaders).toMatchObject({ "x-goog-if-generation-match": "0" })
	})
})
