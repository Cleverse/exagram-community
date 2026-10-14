import { describe, expect, it, vi } from "vitest"

import { DbEnvSchema, resolveDbEnv } from "./db.env"

const URL = "postgres://exagram:exagram@localhost:25432/exagram"

describe("DbEnvSchema", () => {
	it("defaults every optional key when absent", () => {
		expect(DbEnvSchema.parse({ DATABASE_URL: URL })).toEqual({
			DATABASE_URL: URL,
			DATABASE_MAX_CONNECTIONS: 10,
			DATABASE_PLAINTEXT_HOSTS: [],
			DATABASE_CA_SERVER_SPECIFIC: false,
		})
	})

	it.each(["DATABASE_MAX_CONNECTIONS", "DATABASE_PLAINTEXT_HOSTS", "DATABASE_CA_SERVER_SPECIFIC"])(
		'treats "" for %s as unset',
		(key) => {
			expect(DbEnvSchema.parse({ DATABASE_URL: URL, [key]: "" })).toEqual(DbEnvSchema.parse({ DATABASE_URL: URL }))
		},
	)

	it("parses set values", () => {
		expect(
			DbEnvSchema.parse({
				DATABASE_URL: URL,
				DATABASE_MAX_CONNECTIONS: "4",
				DATABASE_PLAINTEXT_HOSTS: " postgres , db.internal,,",
				DATABASE_CA_SERVER_SPECIFIC: "true",
			}),
		).toEqual({
			DATABASE_URL: URL,
			DATABASE_MAX_CONNECTIONS: 4,
			DATABASE_PLAINTEXT_HOSTS: ["postgres", "db.internal"],
			DATABASE_CA_SERVER_SPECIFIC: true,
		})
	})

	it("refuses a pool below 2 and a missing URL", () => {
		expect(() => DbEnvSchema.parse({ DATABASE_URL: URL, DATABASE_MAX_CONNECTIONS: "1" })).toThrow()
		expect(() => DbEnvSchema.parse({ DATABASE_URL: "" })).toThrow()
		expect(() => DbEnvSchema.parse({})).toThrow()
	})
})

describe("resolveDbEnv", () => {
	it("resolves the app connection and hands each warning to warn", () => {
		const warn = vi.fn()
		const resolved = resolveDbEnv(DbEnvSchema.parse({ DATABASE_URL: URL, DATABASE_MAX_CONNECTIONS: "3" }), warn)
		expect(resolved).toMatchObject({ url: URL, ssl: false, max: 3 })
		expect(resolved.warnings).toHaveLength(1)
		expect(warn).toHaveBeenCalledWith(resolved.warnings[0])
	})

	it("uses the plaintext list and server-specific flag", () => {
		const env = DbEnvSchema.parse({
			DATABASE_URL: "postgres://u:p@db.internal:5432/exagram?sslmode=verify-ca&sslrootcert=/ca.pem",
			DATABASE_CA_SERVER_SPECIFIC: "true",
		})
		expect(resolveDbEnv(env, vi.fn(), () => "CA").ssl).toMatchObject({ rejectUnauthorized: true, ca: "CA" })

		const plain = DbEnvSchema.parse({
			DATABASE_URL: "postgres://u:p@db.internal:5432/exagram?sslmode=disable",
			DATABASE_PLAINTEXT_HOSTS: "db.internal",
		})
		expect(resolveDbEnv(plain, vi.fn()).ssl).toBe(false)
	})
})
