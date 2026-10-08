import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { approveRevision, seedArtifact, seedRevision, seedUser, seedWorkspace } from "../../test/seed"

import { ArtifactsRepository } from "./artifacts.repository"
import { LedgerRepository } from "./ledger.repository"
import { SearchRepository } from "./search.repository"

/**
 * The server operator's Reset Link command is a Ledger principal whose id is the account it acted on. It
 * must never read: the visibility functions give it nothing, even for that account's own Artifacts and
 * an Artifact the account could open by General Access.
 */
describe("the operator principal (integration)", () => {
	it("sees no Artifact, even its account's own or one open to that account by General Access", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@acme.test" })
			const colleague = await seedUser(sql, { workspaceId: ws, email: "colleague@example.com" })
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${ws}, 'acme.test')`
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${owner}, 'google', 'owner-google', 'owner@acme.test')`
			const own = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Own plan" })
			const ownRevision = await seedRevision(sql, { artifactId: own, seq: 1, authorUserId: owner })
			await approveRevision(sql, own, ownRevision)
			const org = await seedArtifact(sql, { workspaceId: ws, ownerId: colleague, title: "Org plan" })
			const orgRevision = await seedRevision(sql, { artifactId: org, seq: 1, authorUserId: colleague })
			await approveRevision(sql, org, orgRevision)
			await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${org}`

			// The same id as a user reads both, so the empty answers below come from the kind alone.
			expect(await sql`SELECT * FROM exagram.visible_artifact('user', ${owner}::uuid, ${own}::uuid)`).toHaveLength(1)
			expect(await sql`SELECT * FROM exagram.visible_artifact('user', ${owner}::uuid, ${org}::uuid)`).toHaveLength(1)

			expect(await sql`SELECT * FROM exagram.visible_artifacts('operator', ${owner}::uuid)`).toEqual([])
			expect(await sql`SELECT * FROM exagram.visible_artifact('operator', ${owner}::uuid, ${own}::uuid)`).toEqual([])
			expect(await sql`SELECT * FROM exagram.visible_artifact('operator', ${owner}::uuid, ${org}::uuid)`).toEqual([])
			expect(
				await new ArtifactsRepository(sql).listVisible(
					{ kind: "operator", id: owner },
					{ workspaceId: ws, scope: "all" },
				),
			).toEqual([])
			expect(
				await new SearchRepository(sql).search({
					principalKind: "operator",
					principalId: owner,
					surface: "operator",
					workspaceId: ws,
					query: "plan",
					limit: 20,
				}),
			).toEqual([])
		}))

	it("is a Ledger call the account's Workspace Activity lists with no person behind it", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const otherWs = await seedWorkspace(sql, "Other")
			const member = await seedUser(sql, { workspaceId: ws, email: "member@acme.test" })
			const ledger = new LedgerRepository(sql)
			const callId = await ledger.startCall({
				principalKind: "operator",
				principalId: member,
				surface: "operator",
				action: "workspace.member.password_reset.create",
				subject: "member@acme.test",
			})
			await ledger.recordServe({
				callId,
				artifactId: null,
				revisionId: null,
				outcome: "served",
				reason: null,
				form: null,
				detectorVersion: null,
			})

			const rows = await ledger.listActivity(ws, 50, null)
			expect(rows.map((row) => row.entry)).toEqual([
				expect.objectContaining({
					callId,
					principalKind: "operator",
					principalId: member,
					surface: "operator",
					action: "workspace.member.password_reset.create",
					actor: null,
					subject: "member@acme.test",
				}),
			])
			expect(await ledger.listActivity(otherWs, 50, null)).toEqual([])
		}))

	it("is refused as a principal or a surface by no other name", () =>
		withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const member = await seedUser(sql, { workspaceId: ws, email: "member@acme.test" })
			await expect(
				sql`INSERT INTO exagram.ledger_calls (principal_kind, principal_id, surface, action)
					VALUES ('root', ${member}::uuid, 'operator', 'x')`,
			).rejects.toThrow(/ledger_calls_principal_kind_check/)
			await expect(
				sql`INSERT INTO exagram.ledger_calls (principal_kind, principal_id, surface, action)
					VALUES ('operator', ${member}::uuid, 'shell', 'x')`,
			).rejects.toThrow(/ledger_calls_surface_check/)
		}))
})
