import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { approveRevision, seedArtifact, seedGrant, seedRevision, seedUser, seedWorkspace } from "../../test/seed"

import type { Sql } from "postgres"

type Row = { access: string; org_only: boolean; download: boolean }

const HASH = "$argon2id$seed"

const readWith = (sql: Sql, kind: string, id: string, artifactId: string, unlock: string | null) =>
	sql<Row[]>`SELECT * FROM exagram.visible_artifact(${kind}, ${id}::uuid, ${artifactId}::uuid, ${unlock}::text)`

const commentableWith = (sql: Sql, id: string, artifactId: string, unlock: string | null) =>
	sql<Row[]>`SELECT * FROM exagram.commentable_artifact('user', ${id}::uuid, ${artifactId}::uuid, ${unlock}::text)`

const gateOf = async (sql: Sql, kind: string, id: string, artifactId: string, unlock: string | null = null) => {
	const [row] = await sql<{ gate: string | null }[]>`
		SELECT exagram.anyone_gate(${kind}, ${id}::uuid, ${artifactId}::uuid, ${unlock}::text) AS gate
	`
	return row?.gate
}

const unlockFor = (sql: Sql, artifactId: string, token: string, lifetime = "1 hour") =>
	sql`INSERT INTO exagram.anyone_unlocks (token_hash, artifact_id, expires_at)
		VALUES (${token}, ${artifactId}, now() + ${lifetime}::interval)`

const requirePassword = (sql: Sql, artifactId: string) =>
	sql`UPDATE exagram.artifacts SET anyone_password_on = true, anyone_password_hash = ${HASH} WHERE id = ${artifactId}`

/** An Artifact open to anyone with the link, a Grant on it, and the three readers only that tier admits. */
const setup = async (sql: Sql) => {
	const ws = await seedWorkspace(sql)
	const otherWs = await seedWorkspace(sql, "Other")
	const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
	const colleague = await seedUser(sql, { workspaceId: ws, email: "colleague@example.com" })
	const grantee = await seedUser(sql, { workspaceId: ws, email: "grantee@example.com" })
	const outsider = await seedUser(sql, { workspaceId: otherWs, email: "outsider@example.com" })
	const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Plan" })
	const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
	await approveRevision(sql, artifact, revision)
	await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifact}`
	await seedGrant(sql, { artifactId: artifact, granteeId: grantee, role: "view", createdBy: owner })
	const tier: [string, string][] = [
		["anonymous", artifact],
		["user", colleague],
		["user", outsider],
	]
	return { ws, owner, colleague, grantee, outsider, artifact, tier }
}

describe("visible_artifact password, expiry and download on 'anyone' (integration)", () => {
	it("holds a password-protected file back from the tier's readers until they hold a live unlock", () =>
		withDb(async (sql) => {
			const { ws, owner, grantee, artifact, tier } = await setup(sql)
			const other = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Other" })
			await requirePassword(sql, artifact)
			await unlockFor(sql, artifact, "live")
			await unlockFor(sql, artifact, "stale", "-1 minute")
			await unlockFor(sql, other, "elsewhere")

			for (const [kind, id] of tier) {
				expect(await readWith(sql, kind, id, artifact, null)).toEqual([])
				expect(await readWith(sql, kind, id, artifact, "unknown")).toEqual([])
				expect(await readWith(sql, kind, id, artifact, "stale")).toEqual([])
				expect(await readWith(sql, kind, id, artifact, "elsewhere")).toEqual([])
				expect(await readWith(sql, kind, id, artifact, "live")).toHaveLength(1)
			}

			// The Owner and a Grant come from visible_artifacts, ahead of the tier: no password for them.
			expect(await readWith(sql, "user", owner, artifact, null)).toMatchObject([{ access: "owner", download: true }])
			expect(await readWith(sql, "user", grantee, artifact, null)).toMatchObject([{ access: "view", download: true }])

			await sql`UPDATE exagram.artifacts SET anyone_password_on = false WHERE id = ${artifact}`
			for (const [kind, id] of tier) expect(await readWith(sql, kind, id, artifact, null)).toHaveLength(1)
		}))

	it("closes an expired address to the tier and leaves a Grant and the Owner their reads", () =>
		withDb(async (sql) => {
			const { owner, grantee, artifact, tier } = await setup(sql)
			await sql`UPDATE exagram.artifacts SET anyone_expires_at = now() + interval '1 day' WHERE id = ${artifact}`
			for (const [kind, id] of tier) expect(await readWith(sql, kind, id, artifact, null)).toHaveLength(1)

			await sql`UPDATE exagram.artifacts SET anyone_expires_at = now() - interval '1 second' WHERE id = ${artifact}`
			for (const [kind, id] of tier) expect(await readWith(sql, kind, id, artifact, null)).toEqual([])
			expect(await readWith(sql, "user", owner, artifact, null)).toHaveLength(1)
			expect(await readWith(sql, "user", grantee, artifact, null)).toHaveLength(1)

			await sql`UPDATE exagram.artifacts SET anyone_expires_at = NULL WHERE id = ${artifact}`
			for (const [kind, id] of tier) expect(await readWith(sql, kind, id, artifact, null)).toHaveLength(1)
		}))

	it("withholds download only from the tier's readers, and only while the file is open to anyone", () =>
		withDb(async (sql) => {
			const { ws, owner, colleague, grantee, artifact, tier } = await setup(sql)
			await sql`UPDATE exagram.artifacts SET anyone_download = false WHERE id = ${artifact}`
			for (const [kind, id] of tier) {
				expect(await readWith(sql, kind, id, artifact, null)).toMatchObject([{ download: false }])
			}
			expect(await readWith(sql, "user", owner, artifact, null)).toMatchObject([{ download: true }])
			expect(await readWith(sql, "user", grantee, artifact, null)).toMatchObject([{ download: true }])
			expect(await commentableWith(sql, colleague, artifact, null)).toMatchObject([{ org_only: true, download: false }])

			// 'org' never reads the 'anyone' columns.
			await sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${ws}, 'acme.test')`
			await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
				VALUES (${colleague}, 'google', 'colleague', 'colleague@acme.test')`
			await sql`UPDATE exagram.artifacts SET general_access = 'org', anyone_password_on = true,
				anyone_password_hash = ${HASH}, anyone_expires_at = now() - interval '1 day' WHERE id = ${artifact}`
			expect(await readWith(sql, "user", colleague, artifact, null)).toMatchObject([{ org_only: true, download: true }])
		}))

	it("carries the unlock through the Comments boundary, which still refuses an outsider", () =>
		withDb(async (sql) => {
			const { colleague, outsider, artifact } = await setup(sql)
			await requirePassword(sql, artifact)
			await unlockFor(sql, artifact, "live")

			expect(await commentableWith(sql, colleague, artifact, null)).toEqual([])
			expect(await commentableWith(sql, colleague, artifact, "live")).toMatchObject([
				{ access: "view", org_only: true },
			])
			expect(await commentableWith(sql, outsider, artifact, "live")).toEqual([])
		}))

	it("refuses a password switched on without a hash", () =>
		withDb(async (sql) => {
			const { artifact } = await setup(sql)
			await expect(sql`UPDATE exagram.artifacts SET anyone_password_on = true WHERE id = ${artifact}`).rejects.toThrow(
				/artifacts_anyone_password_check/,
			)
		}))
})

describe("anyone_gate (integration)", () => {
	it("names the gate a refused reader met, and expiry outranks the password", () =>
		withDb(async (sql) => {
			const { artifact, tier } = await setup(sql)
			for (const [kind, id] of tier) expect(await gateOf(sql, kind, id, artifact)).toBeNull()

			await requirePassword(sql, artifact)
			await unlockFor(sql, artifact, "live")
			for (const [kind, id] of tier) {
				expect(await gateOf(sql, kind, id, artifact)).toBe("password")
				expect(await gateOf(sql, kind, id, artifact, "live")).toBeNull()
			}

			await sql`UPDATE exagram.artifacts SET anyone_expires_at = now() - interval '1 minute' WHERE id = ${artifact}`
			for (const [kind, id] of tier) {
				expect(await gateOf(sql, kind, id, artifact)).toBe("expired")
				expect(await gateOf(sql, kind, id, artifact, "live")).toBe("expired")
			}

			await sql`UPDATE exagram.artifacts SET anyone_password_on = false WHERE id = ${artifact}`
			expect(await gateOf(sql, "anonymous", artifact, artifact)).toBe("expired")
		}))

	it("answers NULL, as for a missing Artifact, for anything the tier does not cover", () =>
		withDb(async (sql) => {
			const { owner, colleague, artifact } = await setup(sql)
			await requirePassword(sql, artifact)
			await sql`UPDATE exagram.artifacts SET anyone_expires_at = now() - interval '1 minute' WHERE id = ${artifact}`

			// Another Artifact's address, an id that is no user, and principals that never meet the tier.
			expect(await gateOf(sql, "anonymous", owner, artifact)).toBeNull()
			expect(await gateOf(sql, "user", artifact, artifact)).toBeNull()
			expect(await gateOf(sql, "connection", colleague, artifact)).toBeNull()
			expect(await gateOf(sql, "link", colleague, artifact)).toBeNull()

			for (const setting of ["restricted", "org"]) {
				await sql`UPDATE exagram.artifacts SET general_access = ${setting} WHERE id = ${artifact}`
				expect(await gateOf(sql, "anonymous", artifact, artifact)).toBeNull()
			}
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone', deleted_at = now() WHERE id = ${artifact}`
			expect(await gateOf(sql, "anonymous", artifact, artifact)).toBeNull()
			await sql`UPDATE exagram.artifacts SET deleted_at = NULL, current_revision_id = NULL WHERE id = ${artifact}`
			expect(await gateOf(sql, "anonymous", artifact, artifact)).toBeNull()
		}))
})
