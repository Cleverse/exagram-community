import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { approveRevision, seedArtifact, seedRevision, seedUser, seedWorkspace } from "../../test/seed"

import { AnyoneUnlocksRepository } from "./anyone-unlocks.repository"
import { ArtifactsRepository } from "./artifacts.repository"
import { VisibilityRepository } from "./visibility.repository"

import type { Sql } from "postgres"

const HASH = "$argon2id$not-a-real-hash"
const TOKEN = "b".repeat(64)
const TOMORROW = () => new Date(Date.now() + 24 * 3600 * 1000)

const setup = async (sql: Sql) => {
	const ws = await seedWorkspace(sql)
	const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
	const stranger = await seedUser(sql, { workspaceId: await seedWorkspace(sql, "Other"), email: "s@example.com" })
	const artifact = await seedArtifact(sql, { workspaceId: ws, ownerId: owner, title: "Plan" })
	const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: owner })
	await approveRevision(sql, artifact, revision)
	await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifact}`
	return {
		owner,
		stranger,
		artifact,
		artifacts: new ArtifactsRepository(sql),
		unlocks: new AnyoneUnlocksRepository(sql),
		visibility: new VisibilityRepository(sql),
	}
}

describe("ArtifactsRepository.setAnyoneSettings (integration)", () => {
	it("changes only what the patch names, clears the expiry on null, and tells the Owner what is set", () =>
		withDb(async (sql) => {
			const { owner, artifact, artifacts } = await setup(sql)
			const expiresAt = TOMORROW()

			expect(
				await artifacts.setAnyoneSettings(artifact, owner, { passwordHash: HASH, passwordOn: true, expiresAt }),
			).toBe(true)
			expect(await artifacts.setAnyoneSettings(artifact, owner, { download: false })).toBe(true)
			const row = await artifacts.getVisible({ kind: "user", id: owner }, artifact)
			expect(row).toMatchObject({
				canDownload: true,
				anyoneSettings: { passwordOn: true, passwordSet: true, download: false },
			})
			expect(row?.anyoneSettings.expiresAt?.getTime()).toBe(expiresAt.getTime())
			expect(JSON.stringify(row)).not.toContain(HASH)

			expect(await artifacts.setAnyoneSettings(artifact, owner, { passwordOn: false })).toBe(true)
			expect(await artifacts.setAnyoneSettings(artifact, owner, { expiresAt: null })).toBe(true)
			expect((await artifacts.getVisible({ kind: "user", id: owner }, artifact))?.anyoneSettings).toEqual({
				passwordOn: false,
				passwordSet: true,
				expiresAt: null,
				download: false,
			})
		}))

	it("updates nothing for anyone but the Owner, or for a deleted Artifact", () =>
		withDb(async (sql) => {
			const { owner, stranger, artifact, artifacts } = await setup(sql)
			expect(await artifacts.setAnyoneSettings(artifact, stranger, { download: false })).toBe(false)
			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${artifact}`
			expect(await artifacts.setAnyoneSettings(artifact, owner, { download: false })).toBe(false)
			const [row] = await sql<{ anyone_download: boolean }[]>`
				SELECT anyone_download FROM exagram.artifacts WHERE id = ${artifact}`
			expect(row?.anyone_download).toBe(true)
		}))

	it("refuses to require a password that was never stored", () =>
		withDb(async (sql) => {
			const { owner, artifact, artifacts } = await setup(sql)
			await expect(artifacts.setAnyoneSettings(artifact, owner, { passwordOn: true })).rejects.toThrow(
				/artifacts_anyone_password_check/,
			)
		}))
})

describe("AnyoneUnlocksRepository (integration)", () => {
	it("hands out the hash only while the Artifact is open to anyone behind a live password", () =>
		withDb(async (sql) => {
			const { owner, artifact, artifacts, unlocks } = await setup(sql)
			expect(await unlocks.getPasswordHash(artifact)).toBeNull()

			await artifacts.setAnyoneSettings(artifact, owner, { passwordHash: HASH, passwordOn: true })
			expect(await unlocks.getPasswordHash(artifact)).toBe(HASH)

			await artifacts.setAnyoneSettings(artifact, owner, { expiresAt: new Date(Date.now() - 1000) })
			expect(await unlocks.getPasswordHash(artifact)).toBeNull()
			await artifacts.setAnyoneSettings(artifact, owner, { expiresAt: null })
			expect(await unlocks.getPasswordHash(artifact)).toBe(HASH)

			await sql`UPDATE exagram.artifacts SET general_access = 'restricted' WHERE id = ${artifact}`
			expect(await unlocks.getPasswordHash(artifact)).toBeNull()
			await sql`UPDATE exagram.artifacts SET general_access = 'anyone', deleted_at = now() WHERE id = ${artifact}`
			expect(await unlocks.getPasswordHash(artifact)).toBeNull()
			await sql`UPDATE exagram.artifacts SET deleted_at = NULL, current_revision_id = NULL WHERE id = ${artifact}`
			expect(await unlocks.getPasswordHash(artifact)).toBeNull()
			expect(await unlocks.getPasswordHash("00000000-0000-4000-8000-000000000000")).toBeNull()
		}))

	it("opens the file to the browser that holds the unlock until its Unlocks are deleted", () =>
		withDb(async (sql) => {
			const { owner, stranger, artifact, artifacts, unlocks, visibility } = await setup(sql)
			await artifacts.setAnyoneSettings(artifact, owner, { passwordHash: HASH, passwordOn: true })
			const reader = { kind: "user" as const, id: stranger }

			expect(await visibility.getVisible(reader, artifact, { unlockHash: TOKEN })).toBeNull()
			expect(await visibility.anyoneGate(reader, artifact, TOKEN)).toBe("password")

			expect(
				await unlocks.insert({ artifactId: artifact, tokenHash: TOKEN, expiresAt: TOMORROW(), passwordHash: HASH }),
			).toBe(true)
			expect(await visibility.getVisible(reader, artifact, { unlockHash: TOKEN })).toMatchObject({
				access: "view",
				download: true,
			})
			expect(await visibility.anyoneGate(reader, artifact, TOKEN)).toBeNull()
			expect(await visibility.getVisible(reader, artifact)).toBeNull()

			await unlocks.deleteForArtifact(artifact)
			expect(await visibility.getVisible(reader, artifact, { unlockHash: TOKEN })).toBeNull()
		}))

	it("stores no Unlock against a password that was replaced or switched off since it was checked", () =>
		withDb(async (sql) => {
			const { owner, stranger, artifact, artifacts, unlocks, visibility } = await setup(sql)
			const replacement = "$argon2id$replacement"
			await artifacts.setAnyoneSettings(artifact, owner, { passwordHash: HASH, passwordOn: true })
			// A reader checked HASH; the Owner then replaces the password and ends the Unlocks that exist.
			await artifacts.setAnyoneSettings(artifact, owner, { passwordHash: replacement })
			await unlocks.deleteForArtifact(artifact)

			const checkedBefore = { artifactId: artifact, tokenHash: TOKEN, expiresAt: TOMORROW(), passwordHash: HASH }
			expect(await unlocks.insert(checkedBefore)).toBe(false)
			expect(await visibility.getVisible({ kind: "user", id: stranger }, artifact, { unlockHash: TOKEN })).toBeNull()
			expect(await unlocks.insert({ ...checkedBefore, passwordHash: replacement })).toBe(true)

			await artifacts.setAnyoneSettings(artifact, owner, { passwordOn: false })
			const other = { ...checkedBefore, tokenHash: "c".repeat(64), passwordHash: replacement }
			expect(await unlocks.insert(other)).toBe(false)
		}))

	it("takes the unlock through the Comments boundary and reports the Owner's download choice", () =>
		withDb(async (sql) => {
			const { owner, stranger, artifact, artifacts, unlocks, visibility } = await setup(sql)
			await artifacts.setAnyoneSettings(artifact, owner, { passwordHash: HASH, passwordOn: true, download: false })
			expect(
				await unlocks.insert({ artifactId: artifact, tokenHash: TOKEN, expiresAt: TOMORROW(), passwordHash: HASH }),
			).toBe(true)
			const reader = { kind: "user" as const, id: stranger }

			expect(await visibility.getVisible(reader, artifact, { unlockHash: TOKEN })).toMatchObject({ download: false })
			// The stranger is in another Workspace: the Comments boundary refuses them, and the gate stays quiet.
			const refused = { boundary: "commentable" as const, unlockHash: TOKEN }
			expect(await visibility.getVisible(reader, artifact, refused)).toBeNull()
			expect(await visibility.anyoneGate(reader, artifact, TOKEN)).toBeNull()
			expect(await visibility.getVisible({ kind: "user", id: owner }, artifact, refused)).toMatchObject({
				access: "owner",
				download: true,
			})
		}))
})
