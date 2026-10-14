import { generateKeyPairSync } from "node:crypto"

import { composeServiceEnvKeys } from "@exagram/core/test/compose-env"
import { describe, expect, it } from "vitest"

import { parseEnv } from "./env"
import { EDITION_OPTIONAL, EDITION_PLACEHOLDERS } from "./env.selfhost.fixtures"

// Value per key deploy/compose*.yml can pass this service, shaped to satisfy env.ts's schema.
const PLACEHOLDERS: Record<string, string> = {
	NODE_ENV: "production",
	LOG_LEVEL: "info",
	HTTP_PORT: "3000",
	SHUTDOWN_TIMEOUT_SEC: "30",
	API_ORIGIN: "https://api.example.test",
	WEB_ORIGIN: "https://app.example.test",
	USERCONTENT_ORIGIN: "https://uc.example.test",
	CLIENT_IP_HEADER: "x-real-ip",
	DATABASE_URL: "postgres://exagram:exagram@localhost:5432/exagram",
	DATABASE_MAX_CONNECTIONS: "10",
	DATABASE_PLAINTEXT_HOSTS: "postgres",
	DATABASE_CA_SERVER_SPECIFIC: "false",
	SESSION_COOKIE_SECURE: "true",
	USERCONTENT_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
	UPLOAD_TOKEN_SECRET: "fedcba9876543210fedcba9876543210",
	STORAGE_DRIVER: "filesystem",
	STORAGE_DIR: "/var/lib/exagram/objects",
	S3_ENDPOINT: "https://s3.example.test",
	S3_PUBLIC_ENDPOINT: "https://s3-public.example.test",
	S3_REGION: "us-east-1",
	S3_BUCKET: "exagram",
	S3_ACCESS_KEY_ID: "minioadmin",
	S3_SECRET_ACCESS_KEY: "minioadmin",
	S3_FORCE_PATH_STYLE: "true",
	S3_HTTP_HOSTS: "minio.internal",
	GCS_BUCKET: "exagram",
	GCS_PROJECT_ID: "exagram-test",
	GCS_CREATE_ONLY_UPLOADS: "true",
	GCS_SERVICE_ACCOUNT_KEY_BASE64: Buffer.from(
		JSON.stringify({ client_email: "exagram@exagram-test.iam.gserviceaccount.com", private_key: "test-key" }),
	).toString("base64"),
	OIDC_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
	OIDC_JWKS: '{"keys":[]}',
	MCP_RATE_LIMIT_PER_MINUTE: "60",
	GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
	GOOGLE_CLIENT_SECRET: "test-secret",
	APPLE_SERVICES_ID: "app.exagram.web",
	APPLE_TEAM_ID: "TEAM123456",
	APPLE_KEY_ID: "KEY1234567",
	// One line with `\n` escapes, as a compose .env file holds it.
	APPLE_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ type: "pkcs8", format: "pem" })
		.toString()
		.replaceAll("\n", "\\n"),
	APPLE_NATIVE_CLIENT_IDS: "app.exagram.ios,app.exagram.mac",
}

const OPTIONAL =
	/^(DATABASE_MAX_CONNECTIONS|DATABASE_PLAINTEXT_HOSTS|DATABASE_CA_SERVER_SPECIFIC|S3_[A-Z_]+|GCS_[A-Z_]+|APPLE_[A-Z_]+)$/

const placeholderFor = (key: string): string | undefined => PLACEHOLDERS[key] ?? EDITION_PLACEHOLDERS[key]
const isOptional = (key: string): boolean => OPTIONAL.test(key) || EDITION_OPTIONAL.includes(key)

describe("self-hosted env contract", () => {
	it("accepts every key compose.yml's api service allowlist passes", () => {
		const keys = composeServiceEnvKeys("api")
		expect(keys.length).toBeGreaterThan(0)

		const source: Record<string, string> = {}
		for (const key of keys) {
			const placeholder = placeholderFor(key)
			if (placeholder === undefined) {
				throw new Error(`no placeholder for compose.yml api key: ${key}`)
			}
			source[key] = placeholder
		}

		expect(() => parseEnv(source)).not.toThrow()
	})

	// Compose renders an unset `${X:-}` as "", which must boot like an unset key.
	it("boots with every optional key compose.yml's api service passes set to empty", () => {
		const source: Record<string, string> = {}
		for (const key of composeServiceEnvKeys("api")) {
			const placeholder = placeholderFor(key)
			if (placeholder === undefined) {
				throw new Error(`no placeholder for compose.yml api key: ${key}`)
			}
			source[key] = isOptional(key) ? "" : placeholder
		}

		const env = parseEnv(source)
		expect(env).toMatchObject({
			DATABASE_MAX_CONNECTIONS: 10,
			DATABASE_PLAINTEXT_HOSTS: [],
			DATABASE_CA_SERVER_SPECIFIC: false,
		})
	})
})
