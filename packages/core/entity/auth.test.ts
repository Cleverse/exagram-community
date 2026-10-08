import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "./auth"

describe("claim-only sentinel", () => {
	it("matches the literal the Restricted Shares trigger compares against", () => {
		const migration = readFileSync(
			new URL("../../../database/postgres/migrations/000026_restricted_shares_google_identity.up.sql", import.meta.url),
			"utf8",
		)
		expect(migration).toContain(`'${GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL}'`)
	})
})
