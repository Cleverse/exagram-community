import { describe, expect, it } from "vitest"

import { FilesystemUploadSigner } from "./filesystem.signer"
import { UploadTokenSigner } from "./filesystem.upload-token"

const secret = "0123456789abcdef0123456789abcdef"

describe("FilesystemUploadSigner.createUploadTicket", () => {
	it("points an absolute URL at the upload route with a token for the key, size, mime and expiry", async () => {
		const signer = new FilesystemUploadSigner(
			{ uploadOrigin: "https://app.example.test", secret, ticketTtlSeconds: 300 },
			() => 1_000,
		)

		const ticket = await signer.createUploadTicket({
			storageKey: "artifacts/a/b",
			mime: "application/pdf",
			bytes: 1234,
		})

		expect(ticket).toMatchObject({
			storageKey: "artifacts/a/b",
			expiresInSeconds: 300,
			requiredHeaders: { "content-type": "application/pdf" },
		})
		const url = new URL(ticket.url)
		expect(url.origin).toBe("https://app.example.test")
		const token = url.pathname.replace(/^\/v1\/uploads\//, "")
		expect(new UploadTokenSigner(secret).verify(token, 1_000)).toEqual({
			storageKey: "artifacts/a/b",
			bytes: 1234,
			mime: "application/pdf",
			expiresAt: 301_000,
		})
	})
})
