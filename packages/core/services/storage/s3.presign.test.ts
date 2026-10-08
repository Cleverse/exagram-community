import { afterEach, describe, expect, it, vi } from "vitest"

import { S3UploadSigner } from "./s3.signer"

// Presigning is offline: these run the real SDK against a URL nothing ever requests.
const config = {
	endpoint: "http://localhost:9000",
	region: "us-east-1",
	bucket: "exagram",
	forcePathStyle: true,
	ticketTtlSeconds: 300,
}

const presign = async (signer: S3UploadSigner): Promise<URL> =>
	new URL((await signer.createUploadTicket({ storageKey: "artifacts/a/b", mime: "application/pdf", bytes: 1234 })).url)

describe("S3UploadSigner presigned URL", () => {
	afterEach(() => vi.unstubAllEnvs())

	it("carries no checksum parameter and still signs content-length, content-type and if-none-match", async () => {
		const url = await presign(new S3UploadSigner({ ...config, accessKeyId: "id", secretAccessKey: "secret" }))

		expect(url.search.toLowerCase()).not.toContain("x-amz-checksum")
		expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
			expect.arrayContaining(["content-length", "content-type", "host", "if-none-match"]),
		)
		expect(url.searchParams.has("If-None-Match")).toBe(false)
	})

	it("carries X-Amz-Security-Token when the default chain yields session credentials", async () => {
		vi.stubEnv("AWS_ACCESS_KEY_ID", "ASIAEXAMPLE")
		vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret")
		vi.stubEnv("AWS_SESSION_TOKEN", "session-token")

		const url = await presign(new S3UploadSigner(config))

		expect(url.searchParams.get("X-Amz-Security-Token")).toBe("session-token")
		expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^ASIAEXAMPLE\//)
	})

	it("addresses the URL to the endpoint's host, or to publicEndpoint's when set", async () => {
		const keys = { accessKeyId: "id", secretAccessKey: "secret" }
		expect((await presign(new S3UploadSigner({ ...config, ...keys }))).host).toBe("localhost:9000")
		expect(
			(
				await presign(
					new S3UploadSigner({
						...config,
						...keys,
						endpoint: "http://minio:9000",
						publicEndpoint: "https://s3.example.test",
					}),
				)
			).host,
		).toBe("s3.example.test")
	})
})
