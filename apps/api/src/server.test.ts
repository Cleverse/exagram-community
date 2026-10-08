import { describe, expect, it } from "vitest"

import { type Env, parseEnv } from "./env"
import { buildServer } from "./server"

const TEST_ENV: Env = parseEnv({
	NODE_ENV: "test",
	HTTP_PORT: "0",
	LOG_LEVEL: "silent",
	SHUTDOWN_TIMEOUT_SEC: "5",
	API_ORIGIN: "http://localhost:3000",
	WEB_ORIGIN: "http://localhost:5173",
	LINK_ORIGIN: "http://localhost:5173",
	USERCONTENT_ORIGIN: "http://localhost:3002",
	CLIENT_IP_HEADER: "none",
	DATABASE_URL: "postgres://exagram:exagram@localhost:5432/exagram",
	DATABASE_MAX_CONNECTIONS: "2",
	SESSION_TTL_SECONDS: "1209600",
	SESSION_COOKIE_SECURE: "false",
	UPLOAD_TICKET_TTL_SECONDS: "300",
	USERCONTENT_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
	USERCONTENT_TOKEN_TTL_SEC: "300",
	STORAGE_DRIVER: "s3",
	S3_ENDPOINT: "http://localhost:9000",
	S3_REGION: "us-east-1",
	S3_BUCKET: "exagram",
	S3_ACCESS_KEY_ID: "exagram",
	S3_SECRET_ACCESS_KEY: "exagram-secret",
	S3_FORCE_PATH_STYLE: "true",
	UPLOAD_MAX_BYTES: "20971520",
	OIDC_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
	OIDC_JWKS: '{"keys":[]}',
	MCP_RATE_LIMIT_PER_MINUTE: "60",
})

describe("buildServer", () => {
	it("answers /healthz with ok", async () => {
		const app = buildServer(TEST_ENV)
		const response = await app.inject({ method: "GET", url: "/healthz" })
		expect(response.statusCode).toBe(200)
		expect(response.json()).toEqual({ status: "ok" })
		await app.close()
	})

	it("echoes an inbound x-request-id back on the response", async () => {
		const app = buildServer(TEST_ENV)
		const response = await app.inject({
			method: "GET",
			url: "/healthz",
			headers: { "x-request-id": "req-abc" },
		})
		expect(response.headers["x-request-id"]).toBe("req-abc")
		await app.close()
	})
})
