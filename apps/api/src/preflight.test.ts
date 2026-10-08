import { generateKeyPairSync } from "node:crypto"
import { linkSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { composeServiceEnvKeys } from "@exagram/core/test/compose-env"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { runPreflight } from "./preflight"

const APP_URL = "postgres://exagram:pw@postgres:5432/exagram?sslmode=disable&search_path=exagram%2Cpublic"
const MIGRATE_URL =
	"postgres://exagram:pw@postgres:5432/exagram?sslmode=disable&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"

// The shape gen-secrets.sh writes: one RS256 signing key exported as a private JWK.
const GENERATED_JWKS = JSON.stringify({
	keys: [{ kty: "RSA", n: "abc", e: "AQAB", d: "def", p: "p", q: "q", kid: "k1", use: "sig", alg: "RS256" }],
})

let storageDir: string

beforeEach(() => {
	storageDir = mkdtempSync(join(tmpdir(), "exagram-preflight-"))
})

afterEach(() => {
	rmSync(storageDir, { recursive: true, force: true })
})

// What gen-secrets.sh and compose.postgres.yml give the preflight service by default.
function bundled(): Record<string, string> {
	return {
		NODE_ENV: "production",
		LOG_LEVEL: "info",
		DATABASE_URL: APP_URL,
		MIGRATE_DATABASE_URL: MIGRATE_URL,
		DATABASE_PLAINTEXT_HOSTS: "postgres",
		STORAGE_DRIVER: "filesystem",
		STORAGE_DIR: storageDir,
		USERCONTENT_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
		UPLOAD_TOKEN_SECRET: "fedcba9876543210fedcba9876543210",
		OIDC_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
		OIDC_JWKS: GENERATED_JWKS,
	}
}

const quiet = { log: () => {}, warn: () => {} }

describe("runPreflight", () => {
	it("passes the bundled layers and leaves no probe file behind", () => {
		const log = vi.fn<(line: string) => void>()
		runPreflight(bundled(), { ...quiet, log })
		expect(log.mock.calls.map(([line]) => line)).toEqual([
			"environment ok",
			"DATABASE_URL ok (without TLS)",
			"MIGRATE_DATABASE_URL ok (without TLS)",
			`storage ok (filesystem, wrote, hard-linked and removed a probe file in ${storageDir})`,
		])
		expect(readdirSync(storageDir)).toEqual([])
	})

	it("passes a migrate URL carrying the x-migrations-table parameters over verify-full", () => {
		const env = {
			...bundled(),
			DATABASE_URL: "postgres://u:p@db.example:5432/exagram?sslmode=verify-full&search_path=exagram%2Cpublic",
			MIGRATE_DATABASE_URL:
				"postgres://u:p@db.example:5432/exagram?sslmode=verify-full&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22",
		}
		expect(() => runPreflight(env, quiet)).not.toThrow()
	})

	it("refuses a plaintext external host that DATABASE_PLAINTEXT_HOSTS does not list, naming it", () => {
		const env = {
			...bundled(),
			DATABASE_URL: "postgres://u:p@db.example:5432/exagram?sslmode=disable",
			DATABASE_PLAINTEXT_HOSTS: "",
		}
		expect(() => runPreflight(env, quiet)).toThrow(/DATABASE_URL connects to "db\.example" without TLS/)
	})

	it("checks MIGRATE_DATABASE_URL with the same rules", () => {
		const env = { ...bundled(), MIGRATE_DATABASE_URL: "postgres://u:p@db.example:5432/exagram?sslmode=disable" }
		expect(() => runPreflight(env, quiet)).toThrow(/MIGRATE_DATABASE_URL connects to "db\.example"/)
	})

	it.each([
		["host", "postgres://exagram:pw@other:5432/exagram?sslmode=disable"],
		["port", "postgres://exagram:pw@postgres:5433/exagram?sslmode=disable"],
		["database name", "postgres://exagram:pw@postgres:5432/other?sslmode=disable"],
	])("refuses a MIGRATE_DATABASE_URL with a different %s", (_name, migrate) => {
		const env = { ...bundled(), MIGRATE_DATABASE_URL: migrate, DATABASE_PLAINTEXT_HOSTS: "postgres,other" }
		expect(() => runPreflight(env, quiet)).toThrow(/must name the same database/)
	})

	it.each([
		["DATABASE_URL", { DATABASE_URL: "postgres://exagram:pw@postgres:5432/exa%ZZgram?sslmode=disable" }],
		[
			"MIGRATE_DATABASE_URL",
			{ MIGRATE_DATABASE_URL: "postgres://exagram:pw@postgres:5432/exa%ZZgram?sslmode=disable" },
		],
	])("names %s when its database name is malformed percent-encoding", (key, override) => {
		const env = { ...bundled(), ...override }
		expect(() => runPreflight(env, quiet)).toThrow(new RegExp(`${key} has a database name`))
	})

	it("accepts a MIGRATE_DATABASE_URL with another user, host case and the default port", () => {
		const env = { ...bundled(), MIGRATE_DATABASE_URL: "postgres://owner:x@POSTGRES/exagram?sslmode=disable" }
		expect(() => runPreflight(env, quiet)).not.toThrow()
	})

	it("refuses different sslmode on the two URLs", () => {
		const env = {
			...bundled(),
			DATABASE_URL: "postgres://u:p@db.example:5432/exagram?sslmode=verify-full",
			MIGRATE_DATABASE_URL: "postgres://o:p@db.example:5432/exagram?sslmode=disable",
			DATABASE_PLAINTEXT_HOSTS: "db.example",
		}
		expect(() => runPreflight(env, quiet)).toThrow(
			"DATABASE_URL and MIGRATE_DATABASE_URL must use the same sslmode (verify-full vs disable)",
		)
	})

	it("refuses different sslrootcert on the two URLs", () => {
		const ca = join(storageDir, "ca.pem")
		writeFileSync(ca, "not a real certificate")
		const env = {
			...bundled(),
			DATABASE_URL: `postgres://u:p@db.example:5432/exagram?sslmode=verify-full&sslrootcert=${encodeURIComponent(ca)}`,
			MIGRATE_DATABASE_URL: "postgres://o:p@db.example:5432/exagram?sslmode=verify-full",
		}
		expect(() => runPreflight(env, quiet)).toThrow(
			"DATABASE_URL and MIGRATE_DATABASE_URL must name the same sslrootcert",
		)
	})

	it("refuses sslmode=require", () => {
		const env = { ...bundled(), DATABASE_URL: "postgres://u:p@db.example:5432/exagram?sslmode=require" }
		expect(() => runPreflight(env, quiet)).toThrow(/sslmode=require is not supported/)
	})

	it("refuses a missing MIGRATE_DATABASE_URL", () => {
		const env: Record<string, string> = bundled()
		delete env.MIGRATE_DATABASE_URL
		expect(() => runPreflight(env, quiet)).toThrow(/MIGRATE_DATABASE_URL/)
	})

	it("refuses an unwritable STORAGE_DIR, naming the directory and the uid", () => {
		const writeFile = () => {
			throw Object.assign(new Error("permission denied"), { code: "EACCES" })
		}
		expect(() => runPreflight(bundled(), { ...quiet, writeFile, uid: 1000 })).toThrow(
			`STORAGE_DIR ${storageDir} is not writable by uid 1000 (EACCES)`,
		)
	})

	it("removes the probe file when reading it back fails", () => {
		const readFile = () => {
			throw Object.assign(new Error("i/o error"), { code: "EIO" })
		}
		expect(() => runPreflight(bundled(), { ...quiet, readFile, uid: 1000 })).toThrow(
			`STORAGE_DIR ${storageDir} is not writable by uid 1000 (EIO)`,
		)
		expect(readdirSync(storageDir)).toEqual([])
	})

	it("refuses a STORAGE_DIR that does not support hard links and leaves no probe files", () => {
		const link = () => {
			throw Object.assign(new Error("not permitted"), { code: "EPERM" })
		}
		expect(() => runPreflight(bundled(), { ...quiet, link })).toThrow(
			`STORAGE_DIR ${storageDir} does not support hard links (EPERM), which uploads need`,
		)
		expect(readdirSync(storageDir)).toEqual([])
	})

	it("removes both probe files when the link is made", () => {
		const link = vi.fn(linkSync)
		runPreflight(bundled(), { ...quiet, link })
		expect(link).toHaveBeenCalledOnce()
		expect(readdirSync(storageDir)).toEqual([])
	})

	it("refuses an S3 http endpoint that S3_HTTP_HOSTS does not list", () => {
		const env = {
			...bundled(),
			STORAGE_DRIVER: "s3",
			S3_ENDPOINT: "http://objects.internal:9000",
			S3_HTTP_HOSTS: "other.internal",
		}
		expect(() => runPreflight(env, quiet)).toThrow(/S3_ENDPOINT may use http:\/\/ only.*objects\.internal/)
	})

	it("passes an S3 store without touching the disk", () => {
		const writeFile = vi.fn()
		const env = { ...bundled(), STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://s3.example.test" }
		runPreflight(env, { ...quiet, writeFile })
		expect(writeFile).not.toHaveBeenCalled()
	})

	it("accepts every key compose passes the preflight service, optional ones empty", () => {
		const values: Record<string, string> = { ...bundled(), DATABASE_PLAINTEXT_HOSTS: "postgres" }
		const source: Record<string, string> = {}
		for (const key of composeServiceEnvKeys("preflight")) {
			const value = values[key] ?? (/^(S3_|GCS_|DATABASE_CA_SERVER_SPECIFIC$)/.test(key) ? "" : undefined)
			if (value === undefined) throw new Error(`no value for compose preflight key: ${key}`)
			source[key] = value
		}
		expect(() => runPreflight(source, quiet)).not.toThrow()
	})

	describe("pre-layer-split .env", () => {
		it("refuses an .env with S3_HOST before any other check, even with current keys missing", () => {
			const old = {
				NODE_ENV: "production",
				DATABASE_URL: APP_URL,
				MIGRATE_DATABASE_URL: MIGRATE_URL,
				S3_HOST: "minio.example.test",
			}
			expect(() => runPreflight(old, quiet)).toThrow(/MinIO-based layout.*Installs from before the layer split/)
		})

		it.each(["minio.internal", "minio"])("does not trip on a current S3 endpoint on %s or an empty S3_HOST", (host) => {
			const env = {
				...bundled(),
				STORAGE_DRIVER: "s3",
				S3_ENDPOINT: `http://${host}:9000`,
				S3_HTTP_HOSTS: host,
				S3_HOST: "",
			}
			expect(() => runPreflight(env, quiet)).not.toThrow()
		})
	})

	describe("signing secrets", () => {
		it.each(["USERCONTENT_TOKEN_SECRET", "OIDC_COOKIE_KEYS", "UPLOAD_TOKEN_SECRET"])(
			"refuses the example placeholder for %s",
			(key) => {
				const env = { ...bundled(), [key]: "replace-with-openssl-rand-hex-32-xxxxxxxx" }
				expect(() => runPreflight(env, quiet)).toThrow(new RegExp(`${key}.*deploy/gen-secrets\\.sh`))
			},
		)

		it.each(["USERCONTENT_TOKEN_SECRET", "OIDC_COOKIE_KEYS", "OIDC_JWKS"])("refuses a missing %s", (key) => {
			const env: Record<string, string> = bundled()
			delete env[key]
			expect(() => runPreflight(env, quiet)).toThrow(key)
		})

		it.each([
			["the example empty set", '{"keys":[]}'],
			["not JSON", "replace-with-jwks"],
			["no keys member", "{}"],
			["a public key only", '{"keys":[{"kty":"RSA","n":"abc","e":"AQAB"}]}'],
			["one private and one public key", '{"keys":[{"kty":"RSA","d":"x"},{"kty":"RSA"}]}'],
		])("refuses an OIDC_JWKS that is %s and points at gen-secrets.sh", (_name, jwks) => {
			expect(() => runPreflight({ ...bundled(), OIDC_JWKS: jwks }, quiet)).toThrow(/OIDC_JWKS.*deploy\/gen-secrets\.sh/)
		})

		it("accepts a PEM RSA private key as OIDC_JWKS", () => {
			const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
			const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString()
			expect(() => runPreflight({ ...bundled(), OIDC_JWKS: pem }, quiet)).not.toThrow()
		})

		it("refuses a PEM OIDC_JWKS that is not an RSA key and points at gen-secrets.sh", () => {
			const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
			const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString()
			expect(() => runPreflight({ ...bundled(), OIDC_JWKS: pem }, quiet)).toThrow(
				/OIDC_JWKS.*must be an RSA key.*deploy\/gen-secrets\.sh/,
			)
		})

		it("requires UPLOAD_TOKEN_SECRET for the filesystem store, empty counting as unset", () => {
			expect(() => runPreflight({ ...bundled(), UPLOAD_TOKEN_SECRET: "" }, quiet)).toThrow(
				/UPLOAD_TOKEN_SECRET.*required when STORAGE_DRIVER=filesystem/,
			)
		})

		it("does not need UPLOAD_TOKEN_SECRET for an S3 store", () => {
			const env = {
				...bundled(),
				STORAGE_DRIVER: "s3",
				S3_ENDPOINT: "https://s3.example.test",
				UPLOAD_TOKEN_SECRET: "",
			}
			expect(() => runPreflight(env, quiet)).not.toThrow()
		})
	})
})
