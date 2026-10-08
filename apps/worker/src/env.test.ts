import { describe, expect, it } from "vitest"

import { parseEnv } from "./env"

const base = {
	DATABASE_URL: "postgres://exagram:exagram@localhost:5432/exagram",
	S3_ACCESS_KEY_ID: "minioadmin",
	S3_SECRET_ACCESS_KEY: "minioadmin",
}

describe("parseEnv", () => {
	it("keeps the s3 defaults", () => {
		const env = parseEnv(base)

		expect(env).toMatchObject({
			STORAGE_DRIVER: "s3",
			S3_REGION: "us-east-1",
			S3_BUCKET: "exagram",
			S3_FORCE_PATH_STYLE: false,
		})
		expect(env).not.toHaveProperty("S3_ENDPOINT")
	})

	it("parses gcs without s3 keys", () => {
		const env = parseEnv({ DATABASE_URL: base.DATABASE_URL, STORAGE_DRIVER: "gcs", GCS_BUCKET: "exagram-bucket" })

		expect(env).toMatchObject({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "exagram-bucket" })
		expect(env).not.toHaveProperty("S3_ACCESS_KEY_ID")
	})

	it("defaults WEB_ORIGIN outside production", () => {
		const env = parseEnv(base)
		expect(env.WEB_ORIGIN).toBe("http://localhost:5173")
		expect(env.LINK_ORIGIN).toBe(env.WEB_ORIGIN)
	})

	it("refuses a missing WEB_ORIGIN in production", () => {
		expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow()
	})

	it("parses WEB_ORIGIN in production", () => {
		const env = parseEnv({ ...base, NODE_ENV: "production", WEB_ORIGIN: "https://app.example.com" })
		expect(env.WEB_ORIGIN).toBe("https://app.example.com")
	})

	it("trims a distinct LINK_ORIGIN", () => {
		const env = parseEnv({
			...base,
			NODE_ENV: "production",
			WEB_ORIGIN: "https://app.example.com/",
			LINK_ORIGIN: "https://links.example.com/",
		})
		expect(env.WEB_ORIGIN).toBe("https://app.example.com")
		expect(env.LINK_ORIGIN).toBe("https://links.example.com")
	})
})
