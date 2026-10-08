import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"

describe("000008 search columns", () => {
	it("builds search_tsv from extracted_text and title_tsv from title", async () => {
		await withDb(async (sql) => {
			const [workspace] = await sql<{ id: string }[]>`insert into exagram.workspaces (name) values ('W') returning id`
			const [user] = await sql<{ id: string }[]>`
				insert into exagram.users (workspace_id, email, name, password_hash)
				values (${workspace!.id}, 'a@example.com', 'A', 'x') returning id`
			const [artifact] = await sql<{ id: string; title_tsv: string }[]>`
				insert into exagram.artifacts (workspace_id, owner_id, kind, title)
				values (${workspace!.id}, ${user!.id}, 'doc', 'Pricing memo') returning id, title_tsv`
			const [revision] = await sql<{ search_tsv: string }[]>`
				insert into exagram.revisions
					(artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256, extracted_text, extraction_status)
				values (${artifact!.id}, 1, ${user!.id}, 'bodies/a', 'text/markdown', 9, 'a',
				        'quarterly revenue forecast', 'done')
				returning search_tsv`

			expect(artifact!.title_tsv).toContain("pricing")
			expect(revision!.search_tsv).toContain("forecast")

			const [hit] = await sql<{ ok: number }[]>`
				select 1 as ok from exagram.revisions
				where search_tsv @@ websearch_to_tsquery('simple', 'revenue forecast')`
			expect(hit?.ok).toBe(1)
		})
	})

	it("accepts a body larger than the tsvector ceiling", async () => {
		await withDb(async (sql) => {
			const [workspace] = await sql<{ id: string }[]>`insert into exagram.workspaces (name) values ('W') returning id`
			const [user] = await sql<{ id: string }[]>`
				insert into exagram.users (workspace_id, email, name, password_hash)
				values (${workspace!.id}, 'b@example.com', 'B', 'x') returning id`
			const [artifact] = await sql<{ id: string }[]>`
				insert into exagram.artifacts (workspace_id, owner_id, kind, title)
				values (${workspace!.id}, ${user!.id}, 'pdf', 'Huge') returning id`
			const body = `${"lorem ipsum ".repeat(120_000)}sentinelword`

			const [revision] = await sql<{ len: number }[]>`
				insert into exagram.revisions
					(artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256, extracted_text, extraction_status)
				values (${artifact!.id}, 1, ${user!.id}, 'bodies/b', 'application/pdf', 11, 'b',
				        ${body}, 'done')
				returning length(extracted_text) as len`

			expect(Number(revision!.len)).toBeGreaterThan(1_048_575)

			const [hit] = await sql<{ n: number }[]>`
				select count(*)::int as n from exagram.revisions
				where search_tsv @@ websearch_to_tsquery('simple', 'sentinelword')`
			expect(hit!.n).toBe(0)
		})
	})
})
