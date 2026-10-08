import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { S3UploadSigner } from "./s3.signer"

vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn().mockResolvedValue("https://signed") }))

const config = {
	endpoint: "http://localhost:9000",
	region: "us-east-1",
	bucket: "exagram",
	accessKeyId: "minioadmin",
	secretAccessKey: "minioadmin",
	forcePathStyle: true,
	ticketTtlSeconds: 300,
}

describe("S3UploadSigner.createUploadTicket", () => {
	beforeEach(() => vi.mocked(getSignedUrl).mockClear())

	it("signs content-length into the ticket and echoes the required headers", async () => {
		const signer = new S3UploadSigner(config)
		const ticket = await signer.createUploadTicket({
			storageKey: "artifacts/a/b",
			mime: "application/pdf",
			bytes: 1234,
		})

		expect(ticket).toEqual({
			url: "https://signed",
			storageKey: "artifacts/a/b",
			expiresInSeconds: 300,
			requiredHeaders: { "content-length": "1234", "content-type": "application/pdf", "if-none-match": "*" },
		})

		const [, command, options] = vi.mocked(getSignedUrl).mock.calls[0]!
		expect(command).toBeInstanceOf(PutObjectCommand)
		expect((command as PutObjectCommand).input).toMatchObject({
			Bucket: "exagram",
			Key: "artifacts/a/b",
			ContentType: "application/pdf",
			ContentLength: 1234,
			IfNoneMatch: "*",
		})
		expect(options).toMatchObject({ expiresIn: 300 })
		expect([...(options as { signableHeaders: Set<string> }).signableHeaders]).toEqual(
			expect.arrayContaining(["content-length", "if-none-match"]),
		)
	})

	it("presigns against publicEndpoint, not endpoint, when set", async () => {
		const signer = new S3UploadSigner({ ...config, publicEndpoint: "http://localhost:9000" })
		await signer.createUploadTicket({ storageKey: "artifacts/a/b", mime: "application/pdf", bytes: 1234 })

		const [signingClient] = vi.mocked(getSignedUrl).mock.calls[0]!
		const resolved = await (
			signingClient as unknown as { config: { endpoint: () => Promise<{ hostname: string }> } }
		).config.endpoint()
		expect(resolved.hostname).toBe("localhost")
	})
})
