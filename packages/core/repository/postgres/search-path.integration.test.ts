import postgres from "postgres"
import { describe, expect, inject, it } from "vitest"

import { truncateAll } from "../../test/pg"
import { seedSharing } from "../../test/sharing-fixtures"

import { GrantsRepository } from "./grants.repository"

describe("connection built with search_path=exagram,public (integration)", () => {
	it("still resolves citext, so a grantee-by-email lookup works", async () => {
		const url = new URL(inject("pgUrl"))
		url.searchParams.set("search_path", "exagram,public")

		const sql = postgres(url.toString(), { max: 1, onnotice: () => {} })
		try {
			await truncateAll(sql)
			const fx = await seedSharing(sql)
			const repo = new GrantsRepository(sql)

			expect(await repo.findGranteeByEmail(fx.granteeEmail)).toBe(fx.granteeId)
		} finally {
			await sql.end()
		}
	})
})
