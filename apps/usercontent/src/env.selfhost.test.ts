import { composeServiceEnvKeys } from "@exagram/core/test/compose-env"
import { describe, expect, it } from "vitest"

import { parseEnv } from "./env"

// Value per key deploy/compose*.yml can pass this service, shaped to satisfy env.ts's schema.
const PLACEHOLDERS: Record<string, string> = {
	NODE_ENV: "production",
	LOG_LEVEL: "info",
	HTTP_PORT: "3002",
	DATABASE_URL: "postgres://exagram:exagram@localhost:5432/exagram",
	DATABASE_MAX_CONNECTIONS: "10",
	DATABASE_PLAINTEXT_HOSTS: "postgres",
	DATABASE_CA_SERVER_SPECIFIC: "false",
	USERCONTENT_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
	USERCONTENT_FRAME_ANCESTORS: "https://app.example.test",
	USERCONTENT_ORIGIN: "https://uc.example.test",
	STORAGE_DRIVER: "filesystem",
	STORAGE_DIR: "/var/lib/exagram/objects",
	S3_ENDPOINT: "https://s3.example.test",
	S3_REGION: "us-east-1",
	S3_BUCKET: "exagram",
	S3_ACCESS_KEY_ID: "minioadmin",
	S3_SECRET_ACCESS_KEY: "minioadmin",
	S3_FORCE_PATH_STYLE: "true",
	S3_HTTP_HOSTS: "minio.internal",
	GCS_BUCKET: "exagram",
	GCS_PROJECT_ID: "exagram-test",
	GCS_SERVICE_ACCOUNT_KEY_BASE64: Buffer.from(
		JSON.stringify({ client_email: "exagram@exagram-test.iam.gserviceaccount.com", private_key: "test-key" }),
	).toString("base64"),
}

const OPTIONAL =
	/^(DATABASE_MAX_CONNECTIONS|DATABASE_PLAINTEXT_HOSTS|DATABASE_CA_SERVER_SPECIFIC|S3_[A-Z_]+|GCS_[A-Z_]+)$/

describe("self-hosted env contract", () => {
	it("accepts every key compose.yml's usercontent service allowlist passes", () => {
		const keys = composeServiceEnvKeys("usercontent")
		expect(keys.length).toBeGreaterThan(0)

		const source: Record<string, string> = {}
		for (const key of keys) {
			const placeholder = PLACEHOLDERS[key]
			if (placeholder === undefined) {
				throw new Error(`no placeholder for compose.yml usercontent key: ${key}`)
			}
			source[key] = placeholder
		}

		expect(() => parseEnv(source)).not.toThrow()
	})

	// Compose renders an unset `${X:-}` as "", which must boot like an unset key.
	it("boots with every optional key compose.yml's usercontent service passes set to empty", () => {
		const source: Record<string, string> = {}
		for (const key of composeServiceEnvKeys("usercontent")) {
			const placeholder = PLACEHOLDERS[key]
			if (placeholder === undefined) {
				throw new Error(`no placeholder for compose.yml usercontent key: ${key}`)
			}
			source[key] = OPTIONAL.test(key) ? "" : placeholder
		}

		const env = parseEnv(source)
		expect(env).toMatchObject({
			DATABASE_MAX_CONNECTIONS: 10,
			DATABASE_PLAINTEXT_HOSTS: [],
			DATABASE_CA_SERVER_SPECIFIC: false,
		})
	})
})
