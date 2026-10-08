import { describe, expect, it } from "vitest"

import { parseEnv } from "./env"

const base = {
	DATABASE_URL: "postgres://exagram:exagram@localhost:5432/exagram",
	S3_ACCESS_KEY_ID: "minioadmin",
	S3_SECRET_ACCESS_KEY: "minioadmin",
	USERCONTENT_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
	USERCONTENT_FRAME_ANCESTORS: "https://app.example.com",
}

const withoutAncestors = {
	DATABASE_URL: base.DATABASE_URL,
	S3_ACCESS_KEY_ID: base.S3_ACCESS_KEY_ID,
	S3_SECRET_ACCESS_KEY: base.S3_SECRET_ACCESS_KEY,
	USERCONTENT_TOKEN_SECRET: base.USERCONTENT_TOKEN_SECRET,
}

describe("parseEnv", () => {
	it("defaults the shutdown timeout", () => {
		expect(parseEnv(base).SHUTDOWN_TIMEOUT_SEC).toBe(30)
	})

	it("parses a comma-separated list of origins", () => {
		const env = parseEnv({ ...base, USERCONTENT_FRAME_ANCESTORS: "https://app.x,https://api.x" })
		expect(env.USERCONTENT_FRAME_ANCESTORS).toEqual(["https://app.x", "https://api.x"])
	})

	it("parses gcs without s3 keys", () => {
		const env = parseEnv({
			DATABASE_URL: base.DATABASE_URL,
			STORAGE_DRIVER: "gcs",
			GCS_BUCKET: "exagram-bucket",
			USERCONTENT_TOKEN_SECRET: base.USERCONTENT_TOKEN_SECRET,
			USERCONTENT_FRAME_ANCESTORS: "https://app.x,https://api.x",
		})

		expect(env).toMatchObject({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "exagram-bucket" })
		expect(env.USERCONTENT_FRAME_ANCESTORS).toEqual(["https://app.x", "https://api.x"])
		expect(env).not.toHaveProperty("S3_ACCESS_KEY_ID")
	})

	it("defaults to the vite dev origin when unset in development", () => {
		const env = parseEnv({ ...withoutAncestors, NODE_ENV: "development" })
		expect(env.USERCONTENT_FRAME_ANCESTORS).toEqual(["http://localhost:5173"])
	})

	it("defaults to the vite dev origin when unset in test", () => {
		const env = parseEnv({ ...withoutAncestors, NODE_ENV: "test" })
		expect(env.USERCONTENT_FRAME_ANCESTORS).toEqual(["http://localhost:5173"])
	})

	it("refuses a missing USERCONTENT_FRAME_ANCESTORS in production", () => {
		expect(() => parseEnv({ ...withoutAncestors, NODE_ENV: "production" })).toThrow()
	})

	it("refuses an empty USERCONTENT_FRAME_ANCESTORS in production", () => {
		expect(() => parseEnv({ ...base, NODE_ENV: "production", USERCONTENT_FRAME_ANCESTORS: "" })).toThrow()
	})

	it("parses an explicit USERCONTENT_FRAME_ANCESTORS in production", () => {
		const env = parseEnv({ ...base, NODE_ENV: "production" })
		expect(env.USERCONTENT_FRAME_ANCESTORS).toEqual(["https://app.example.com"])
	})

	it("refuses an entry with a path", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_FRAME_ANCESTORS: "https://app.example.com/l" })).toThrow()
	})

	it("refuses an entry with a trailing slash", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_FRAME_ANCESTORS: "https://app.example.com/" })).toThrow()
	})

	it("refuses a wildcard entry", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_FRAME_ANCESTORS: "*" })).toThrow()
	})

	it("refuses a scheme-qualified wildcard entry", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_FRAME_ANCESTORS: "https://*.a.com" })).toThrow()
	})

	it("refuses a CSP-directive-injecting entry", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_FRAME_ANCESTORS: "https://a.com;connect-src" })).toThrow()
	})

	it("refuses a non-http(s) scheme", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_FRAME_ANCESTORS: "ftp://good.com" })).toThrow()
	})

	it("refuses an entry with a trailing space-separated token", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_FRAME_ANCESTORS: "https://a.com 'unsafe-inline'" })).toThrow()
	})

	it("defaults USERCONTENT_ORIGIN to the dev listener outside production", () => {
		expect(parseEnv({ ...withoutAncestors, NODE_ENV: "development" }).USERCONTENT_ORIGIN).toBe("http://localhost:3002")
		expect(parseEnv({ ...withoutAncestors, NODE_ENV: "test", USERCONTENT_ORIGIN: "" }).USERCONTENT_ORIGIN).toBe(
			"http://localhost:3002",
		)
	})

	it("leaves USERCONTENT_ORIGIN unset in production", () => {
		expect(parseEnv({ ...base, NODE_ENV: "production" }).USERCONTENT_ORIGIN).toBeUndefined()
		expect(parseEnv({ ...base, NODE_ENV: "production", USERCONTENT_ORIGIN: "" }).USERCONTENT_ORIGIN).toBeUndefined()
	})

	it("parses USERCONTENT_ORIGIN and strips trailing slashes", () => {
		expect(parseEnv({ ...base, USERCONTENT_ORIGIN: "https://uc.example.com//" }).USERCONTENT_ORIGIN).toBe(
			"https://uc.example.com",
		)
	})

	it.each(["https://uc.example.com/path", "*", "https://a.com;connect-src", "ftp://uc.example.com", "uc.example.com"])(
		"refuses USERCONTENT_ORIGIN %s",
		(value) => {
			expect(() => parseEnv({ ...base, USERCONTENT_ORIGIN: value })).toThrow()
		},
	)

	it("refuses the example placeholder for USERCONTENT_TOKEN_SECRET and points at gen-secrets.sh", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_TOKEN_SECRET: "replace-with-openssl-rand-hex-32-xxxxxxxx" })).toThrow(
			/USERCONTENT_TOKEN_SECRET.*deploy\/gen-secrets\.sh/,
		)
	})
})
