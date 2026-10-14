import { generateKeyPairSync } from "node:crypto"

import { describe, expect, it } from "vitest"

import { parseEnv } from "./env"

const base = {
	DATABASE_URL: "postgres://exagram:exagram@localhost:5432/exagram",
	S3_ACCESS_KEY_ID: "minioadmin",
	S3_SECRET_ACCESS_KEY: "minioadmin",
	USERCONTENT_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
	OIDC_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
	OIDC_JWKS: '{"keys":[]}',
	CLIENT_IP_HEADER: "none",
}

const baseWithoutS3Keys = Object.fromEntries(Object.entries(base).filter(([key]) => !key.startsWith("S3_")))

describe("parseEnv", () => {
	it("defaults the port, the session TTL and the upload ceiling", () => {
		const env = parseEnv(base)
		expect(env.HTTP_PORT).toBe(3000)
		expect(env.SESSION_TTL_SECONDS).toBe(1209600)
		expect(env.UPLOAD_MAX_BYTES).toBe(20971520)
		expect(env).toMatchObject({ STORAGE_DRIVER: "s3", S3_FORCE_PATH_STYLE: false })
	})

	it("caps UPLOAD_TICKET_TTL_SECONDS at a day so the upload deadline stays a valid timer delay", () => {
		expect(parseEnv({ ...base, UPLOAD_TICKET_TTL_SECONDS: "86400" }).UPLOAD_TICKET_TTL_SECONDS).toBe(86_400)
		expect(() => parseEnv({ ...base, UPLOAD_TICKET_TTL_SECONDS: "86401" })).toThrow(/UPLOAD_TICKET_TTL_SECONDS/)
	})

	it("requires CLIENT_IP_HEADER and says what to set", () => {
		const withoutHeader: Record<string, string> = { ...base }
		delete withoutHeader.CLIENT_IP_HEADER
		expect(() => parseEnv(withoutHeader)).toThrow(/CLIENT_IP_HEADER is required.*cf-connecting-ip.*x-real-ip.*none/)
	})

	it("reads CLIENT_IP_HEADER none as the TCP peer", () => {
		expect(parseEnv({ ...base, CLIENT_IP_HEADER: " None " }).CLIENT_IP_HEADER).toBeNull()
	})

	it("trims and lowercases a CLIENT_IP_HEADER name", () => {
		expect(parseEnv({ ...base, CLIENT_IP_HEADER: " CF-Connecting-IP " }).CLIENT_IP_HEADER).toBe("cf-connecting-ip")
	})

	it("rejects x-forwarded-for as a CLIENT_IP_HEADER", () => {
		expect(() => parseEnv({ ...base, CLIENT_IP_HEADER: " X-Forwarded-For " })).toThrow(
			/CLIENT_IP_HEADER cannot be x-forwarded-for.*x-real-ip/,
		)
	})

	it("rejects a CLIENT_IP_HEADER that is not a header name", () => {
		expect(() => parseEnv({ ...base, CLIENT_IP_HEADER: "x real ip" })).toThrow(/CLIENT_IP_HEADER/)
		expect(() => parseEnv({ ...base, CLIENT_IP_HEADER: "" })).toThrow(/CLIENT_IP_HEADER/)
	})

	it("parses GCS storage without S3 keys", () => {
		const env = parseEnv({ ...baseWithoutS3Keys, STORAGE_DRIVER: "gcs", GCS_BUCKET: "b" })
		expect(env.STORAGE_DRIVER).toBe("gcs")
		expect(env).toMatchObject({ GCS_BUCKET: "b" })
	})

	it("requires UPLOAD_TOKEN_SECRET for the filesystem driver only", () => {
		const filesystem = { ...baseWithoutS3Keys, STORAGE_DRIVER: "filesystem", STORAGE_DIR: "/var/lib/exagram/objects" }
		expect(() => parseEnv(filesystem)).toThrow(/UPLOAD_TOKEN_SECRET.*required when STORAGE_DRIVER=filesystem/)
		expect(() => parseEnv({ ...filesystem, UPLOAD_TOKEN_SECRET: "" })).toThrow(/UPLOAD_TOKEN_SECRET/)
		expect(() => parseEnv({ ...filesystem, UPLOAD_TOKEN_SECRET: "too-short" })).toThrow(/UPLOAD_TOKEN_SECRET/)
		const secret = "0123456789abcdef0123456789abcdef"
		expect(parseEnv({ ...filesystem, UPLOAD_TOKEN_SECRET: secret })).toMatchObject({
			STORAGE_DRIVER: "filesystem",
			STORAGE_DIR: "/var/lib/exagram/objects",
			UPLOAD_TOKEN_SECRET: secret,
		})
		expect(parseEnv({ ...base, UPLOAD_TOKEN_SECRET: "" }).UPLOAD_TOKEN_SECRET).toBeUndefined()
	})

	it("defaults LINK_ORIGIN to the default WEB_ORIGIN", () => {
		expect(parseEnv(base).LINK_ORIGIN).toBe("http://localhost:5173")
	})

	it("defaults LINK_ORIGIN to an explicit WEB_ORIGIN", () => {
		const env = parseEnv({ ...base, WEB_ORIGIN: "https://a.test" })
		expect(env.LINK_ORIGIN).toBe("https://a.test")
	})

	it("trims a trailing slash from WEB_ORIGIN and follows it into LINK_ORIGIN", () => {
		const env = parseEnv({ ...base, WEB_ORIGIN: "https://a.test/" })
		expect(env.WEB_ORIGIN).toBe("https://a.test")
		expect(env.LINK_ORIGIN).toBe("https://a.test")
	})

	it("trims a trailing slash from USERCONTENT_ORIGIN", () => {
		expect(parseEnv({ ...base, USERCONTENT_ORIGIN: "https://uc.example.com/" }).USERCONTENT_ORIGIN).toBe(
			"https://uc.example.com",
		)
	})

	it("keeps the default USERCONTENT_ORIGIN", () => {
		expect(parseEnv(base).USERCONTENT_ORIGIN).toBe("http://localhost:3002")
	})

	it("rejects directive injection in USERCONTENT_ORIGIN", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_ORIGIN: "https://a.test;script-src *" })).toThrow(
			/invalid environment: \{"USERCONTENT_ORIGIN":/,
		)
	})

	it("rejects a path in USERCONTENT_ORIGIN", () => {
		expect(() => parseEnv({ ...base, USERCONTENT_ORIGIN: "https://a.test/path" })).toThrow(
			/invalid environment: \{"USERCONTENT_ORIGIN":/,
		)
	})

	it("lets an explicit LINK_ORIGIN win over WEB_ORIGIN", () => {
		const env = parseEnv({ ...base, WEB_ORIGIN: "https://a.test", LINK_ORIGIN: "https://links.test" })
		expect(env.LINK_ORIGIN).toBe("https://links.test")
	})

	it("trims a trailing slash from LINK_ORIGIN", () => {
		expect(parseEnv({ ...base, LINK_ORIGIN: "https://links.test/" }).LINK_ORIGIN).toBe("https://links.test")
	})

	it("reads an empty DATABASE_MAX_CONNECTIONS as unset", () => {
		expect(parseEnv({ ...base, DATABASE_MAX_CONNECTIONS: "" }).DATABASE_MAX_CONNECTIONS).toBe(10)
	})

	it("refuses a missing DATABASE_URL", () => {
		expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow()
	})

	it("accepts Google credentials only when both are present", () => {
		expect(parseEnv({ ...base }).GOOGLE_CLIENT_ID).toBeUndefined()
		expect(parseEnv({ ...base, GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" })).toMatchObject({
			GOOGLE_CLIENT_ID: "client",
			GOOGLE_CLIENT_SECRET: "secret",
		})
		expect(parseEnv({ ...base, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }).GOOGLE_CLIENT_ID).toBeUndefined()
		expect(() => parseEnv({ ...base, GOOGLE_CLIENT_ID: "client" })).toThrow()
		expect(() => parseEnv({ ...base, GOOGLE_CLIENT_SECRET: "secret" })).toThrow()
	})

	describe("Sign in with Apple", () => {
		const pem = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
			.privateKey.export({ type: "pkcs8", format: "pem" })
			.toString()
		const apple = {
			APPLE_SERVICES_ID: "app.exagram.web",
			APPLE_TEAM_ID: "ABCDE12345",
			APPLE_KEY_ID: "KEY1234567",
			APPLE_PRIVATE_KEY: pem,
		}

		it("takes all four keys, the PEM with real newlines or with `\\n` escapes", () => {
			expect(parseEnv({ ...base, ...apple })).toMatchObject({ ...apple, APPLE_PRIVATE_KEY: pem.trim() })
			expect(parseEnv({ ...base, ...apple, APPLE_PRIVATE_KEY: pem.replaceAll("\n", "\\n") }).APPLE_PRIVATE_KEY).toBe(
				pem.trim(),
			)
		})

		it("treats none, or all four empty, as off", () => {
			expect(parseEnv({ ...base }).APPLE_SERVICES_ID).toBeUndefined()
			const empty = Object.fromEntries(Object.keys(apple).map((key) => [key, ""]))
			expect(parseEnv({ ...base, ...empty }).APPLE_PRIVATE_KEY).toBeUndefined()
		})

		it.each(Object.keys(apple))("refuses the others without %s", (missing) => {
			expect(() => parseEnv({ ...base, ...apple, [missing]: "" })).toThrow("must be set together")
		})

		it.each(Object.keys(apple))("refuses %s alone, the native apps included", (only) => {
			expect(() => parseEnv({ ...base, [only]: apple[only as keyof typeof apple] })).toThrow("must be set together")
		})

		it("refuses a key that is not an EC private key", () => {
			const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
				.privateKey.export({ type: "pkcs8", format: "pem" })
				.toString()
			expect(() => parseEnv({ ...base, ...apple, APPLE_PRIVATE_KEY: "not a pem" })).toThrow("APPLE_PRIVATE_KEY")
			expect(() => parseEnv({ ...base, ...apple, APPLE_PRIVATE_KEY: rsa })).toThrow("APPLE_PRIVATE_KEY")
		})
	})

	it.each(["USERCONTENT_TOKEN_SECRET", "UPLOAD_TOKEN_SECRET", "OIDC_COOKIE_KEYS"])(
		"refuses the example placeholder for %s and points at gen-secrets.sh",
		(key) => {
			const placeholder = "replace-with-openssl-rand-hex-32-xxxxxxxx"
			expect(() =>
				parseEnv({ ...base, UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef", [key]: placeholder }),
			).toThrow(new RegExp(`${key}.*deploy/gen-secrets\\.sh`))
		},
	)
})
