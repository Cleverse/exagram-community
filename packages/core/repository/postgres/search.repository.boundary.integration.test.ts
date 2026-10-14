import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"

import { SearchRepository } from "./search.repository"

import type { Sql } from "postgres"

async function seed(sql: Sql) {
	const [workspace] = await sql<{ id: string }[]>`insert into exagram.workspaces (name) values ('W') returning id`
	const [owner] = await sql<{ id: string }[]>`
		insert into exagram.users (email, name, password_hash) values ('owner@example.com', 'Owner', 'x') returning id`
	const [stranger] = await sql<{ id: string }[]>`
		insert into exagram.users (email, name, password_hash) values ('other@example.com', 'Other', 'x') returning id`
	await sql`
		insert into exagram.memberships (user_id, workspace_id, kind, role)
		select u.id, ${workspace!.id}, 'team', 'member' from exagram.users u where u.id in (${owner!.id}, ${stranger!.id})`
	const [artifact] = await sql<{ id: string }[]>`
		insert into exagram.artifacts (workspace_id, owner_id, kind, title)
		values (${workspace!.id}, ${owner!.id}, 'doc', 'Pricing memo') returning id`
	const [revision] = await sql<{ id: string }[]>`
		insert into exagram.revisions
			(artifact_id, seq, status, author_user_id, storage_key, mime, bytes, sha256,
			 extracted_text, extraction_status, approved_at)
		values (${artifact!.id}, 1, 'approved', ${owner!.id}, 'bodies/a', 'text/markdown', 9, 'a',
		        'quarterly revenue forecast', 'done', now())
		returning id`
	await sql`update exagram.artifacts set current_revision_id = ${revision!.id} where id = ${artifact!.id}`
	return {
		workspace: workspace!.id,
		owner: owner!.id,
		stranger: stranger!.id,
		artifact: artifact!.id,
		revision: revision!.id,
	}
}

describe("SearchRepository.search", () => {
	it("finds the owner's artifact by body text and by title", async () => {
		await withDb(async (sql) => {
			const ids = await seed(sql)
			const repository = new SearchRepository(sql)

			const byBody = await repository.search({
				principalKind: "user",
				principalId: ids.owner,
				surface: "web",
				workspaceId: ids.workspace,
				query: "revenue forecast",
				limit: 20,
			})
			const byTitle = await repository.search({
				principalKind: "user",
				principalId: ids.owner,
				surface: "web",
				workspaceId: ids.workspace,
				query: "pricing",
				limit: 20,
			})

			expect(byBody.map((hit) => hit.artifactId)).toEqual([ids.artifact])
			expect(byBody[0]!.snippet).toContain("revenue")
			expect(byTitle.map((hit) => hit.artifactId)).toEqual([ids.artifact])
		})
	})

	it("returns nothing to a user with no grant", async () => {
		await withDb(async (sql) => {
			const ids = await seed(sql)
			const repository = new SearchRepository(sql)

			const hits = await repository.search({
				principalKind: "user",
				principalId: ids.stranger,
				surface: "web",
				workspaceId: ids.workspace,
				query: "revenue forecast",
				limit: 20,
			})

			expect(hits).toEqual([])
		})
	})

	it("writes one ledger call and one served row per hit", async () => {
		await withDb(async (sql) => {
			const ids = await seed(sql)
			const repository = new SearchRepository(sql)

			await repository.search({
				principalKind: "user",
				principalId: ids.owner,
				surface: "web",
				workspaceId: ids.workspace,
				query: "revenue",
				limit: 20,
			})

			const [call] = await sql<{ id: string; action: string; status: string; principal_id: string; surface: string }[]>`
				select id, action, status, principal_id, surface
				from exagram.ledger_calls order by started_at desc limit 1`
			expect(call!.action).toBe("artifacts.search")
			expect(call!.status).toBe("delivered")
			expect(call!.surface).toBe("web")
			expect(call!.principal_id).toBe(ids.owner)

			const serves = await sql<{ artifact_id: string; revision_id: string | null; outcome: string }[]>`
				select artifact_id, revision_id, outcome
				from exagram.ledger_serves where call_id = ${call!.id}`
			expect(serves).toHaveLength(1)
			expect(serves[0]!.artifact_id).toBe(ids.artifact)
			expect(serves[0]!.revision_id).toBe(ids.revision)
			expect(serves[0]!.outcome).toBe("served")
		})
	})

	it("does not return an artifact whose only revision is pending", async () => {
		await withDb(async (sql) => {
			const ids = await seed(sql)
			await sql`update exagram.revisions set status = 'pending', approved_at = null where id = ${ids.revision}`
			await sql`update exagram.artifacts set current_revision_id = null where id = ${ids.artifact}`
			const repository = new SearchRepository(sql)

			const hits = await repository.search({
				principalKind: "user",
				principalId: ids.stranger,
				surface: "web",
				workspaceId: ids.workspace,
				query: "revenue forecast",
				limit: 20,
			})

			expect(hits).toEqual([])
		})
	})
})
