import { anonymousReader } from "@exagram/core/entity/principal"
import { hashUnlockToken } from "@exagram/core/services/unlock-token.service"
import { inlineTx } from "@exagram/core/test/tx"
import { BadRequestError, IncorrectPasswordError } from "@exagram/core/utils/errors"
import { RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { User } from "@exagram/core/entity/auth"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

import { FakeAnyoneUnlocksDatagateway, FakeArtifactsDatagateway } from "../store.datagateway.fake"

import { ANYONE_UNLOCK_TTL_SECONDS, AnyoneUsecase } from "./anyone.usecase"

const owner: User = {
	id: "u1",
	workspaceId: "w1",
	email: "a@acme.test",
	name: "A",
	isAdmin: false,
	googleLinked: false,
	createdAt: new Date(),
}
const stranger: User = { ...owner, id: "u2" }
const NOW = new Date("2026-10-08T09:00:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1000

/** A password service whose "hash" is readable, so a test can see what was stored and what was never. */
const passwords = () => ({
	hash: vi.fn((plain: string) => Promise.resolve(`hashed:${plain}`)),
	verify: vi.fn((hash: string, plain: string) => Promise.resolve(hash === `hashed:${plain}`)),
	verifyDummy: vi.fn(() => Promise.resolve(false)),
})

const build = async (options: { generalAccess?: "anyone" | "restricted"; published?: boolean } = {}) => {
	const artifacts = new FakeArtifactsDatagateway()
	const unlocks = new FakeAnyoneUnlocksDatagateway(artifacts)
	const hasher = passwords()
	const tx = inlineTx()
	const atomic = vi.spyOn(tx, "atomic")
	const ledger = { recordCall: vi.fn<ServeService["recordCall"]>(() => Promise.resolve()) }
	const usecase = new AnyoneUsecase(artifacts, unlocks, hasher, tx, ledger, () => NOW)
	const artifact = await artifacts.create({
		workspaceId: "w1",
		ownerId: owner.id,
		projectId: null,
		kind: "doc",
		title: "Plan",
	})
	artifact.generalAccess = options.generalAccess ?? "anyone"
	if (options.published ?? true) artifact.currentRevisionId = "rev-1"
	return { artifacts, unlocks, hasher, atomic, ledger, usecase, artifact }
}

describe("AnyoneUsecase.setSettings", () => {
	it("refuses everyone but the Owner with the uniform refusal, before hashing anything", async () => {
		const { usecase, hasher, artifact, artifacts } = await build()
		await expect(
			usecase.setSettings(stranger, { artifactId: artifact.id, passwordOn: true, password: "correct horse" }),
		).rejects.toBeInstanceOf(RefusalError)
		await expect(
			usecase.setSettings(owner, { artifactId: "nothing-here", password: "correct horse" }),
		).rejects.toBeInstanceOf(RefusalError)
		expect(hasher.hash).not.toHaveBeenCalled()
		expect(artifacts.settingsOf(artifact.id).passwordOn).toBe(false)
	})

	it("will not switch a password on when none is stored and none comes with the call", async () => {
		const { usecase, artifact, artifacts } = await build()
		await expect(usecase.setSettings(owner, { artifactId: artifact.id, passwordOn: true })).rejects.toEqual(
			new BadRequestError("Set a password first."),
		)
		expect(artifacts.settingsOf(artifact.id)).toMatchObject({ passwordOn: false, passwordSet: false })
	})

	it("stores the hash of a new password, never the password, and shows the Owner only that one is set", async () => {
		const { usecase, artifact, artifacts } = await build()
		const result = await usecase.setSettings(owner, {
			artifactId: artifact.id,
			passwordOn: true,
			password: "correct horse",
		})
		expect(artifacts.passwordHashes.get(artifact.id)).toBe("hashed:correct horse")
		expect(result.anyoneSettings).toEqual({ passwordOn: true, passwordSet: true, expiresAt: null, download: true })
		expect(JSON.stringify(result)).not.toContain("correct horse")
		expect(JSON.stringify(result)).not.toContain("hashed:")
	})

	it("switches a stored password back on without retyping it, and keeps the Unlocks it already earned", async () => {
		const { usecase, unlocks, artifact, artifacts } = await build()
		await usecase.setSettings(owner, { artifactId: artifact.id, passwordOn: true, password: "correct horse" })
		await usecase.unlock(anonymousReader(artifact.id), artifact.id, "correct horse")
		await usecase.setSettings(owner, { artifactId: artifact.id, passwordOn: false })
		expect(artifacts.settingsOf(artifact.id)).toMatchObject({ passwordOn: false, passwordSet: true })

		await usecase.setSettings(owner, { artifactId: artifact.id, passwordOn: true })
		expect(artifacts.settingsOf(artifact.id).passwordOn).toBe(true)
		expect(unlocks.rows).toHaveLength(1)
	})

	it("ends every Unlock in the same transaction as a new password, and not for any other change", async () => {
		const { usecase, unlocks, atomic, artifact } = await build()
		await usecase.setSettings(owner, { artifactId: artifact.id, passwordOn: true, password: "first password" })
		await usecase.unlock(anonymousReader(artifact.id), artifact.id, "first password")
		await usecase.unlock(anonymousReader(artifact.id), artifact.id, "first password")
		expect(unlocks.rows).toHaveLength(2)

		await usecase.setSettings(owner, { artifactId: artifact.id, download: false, expiresInDays: 7 })
		expect(unlocks.rows).toHaveLength(2)

		let open = false
		atomic.mockImplementation(async (fn) => {
			open = true
			try {
				return await fn()
			} finally {
				open = false
			}
		})
		const original = unlocks.deleteForArtifact.bind(unlocks)
		const openWhenDeleted: boolean[] = []
		vi.spyOn(unlocks, "deleteForArtifact").mockImplementation((id) => {
			openWhenDeleted.push(open)
			return original(id)
		})
		await usecase.setSettings(owner, { artifactId: artifact.id, password: "second password" })
		expect(unlocks.rows).toHaveLength(0)
		expect(openWhenDeleted).toEqual([true])
	})

	it("sets the expiry that many days from now, clears it on null and leaves it when absent", async () => {
		const { usecase, artifact, artifacts } = await build()
		await usecase.setSettings(owner, { artifactId: artifact.id, expiresInDays: 7 })
		expect(artifacts.settingsOf(artifact.id).expiresAt).toEqual(new Date(NOW.getTime() + 7 * DAY_MS))

		await usecase.setSettings(owner, { artifactId: artifact.id, download: false })
		expect(artifacts.settingsOf(artifact.id).expiresAt).toEqual(new Date(NOW.getTime() + 7 * DAY_MS))

		await usecase.setSettings(owner, { artifactId: artifact.id, expiresInDays: null })
		expect(artifacts.settingsOf(artifact.id).expiresAt).toBeNull()
		await usecase.setSettings(owner, { artifactId: artifact.id, expiresInDays: 1 })
		expect(artifacts.settingsOf(artifact.id).expiresAt).toEqual(new Date(NOW.getTime() + DAY_MS))
	})

	it("refuses with the uniform refusal if the Artifact stops being the Owner's between the check and the write", async () => {
		const { usecase, artifacts, artifact } = await build()
		vi.spyOn(artifacts, "setAnyoneSettings").mockResolvedValueOnce(false)
		await expect(usecase.setSettings(owner, { artifactId: artifact.id, download: false })).rejects.toBeInstanceOf(
			RefusalError,
		)
	})

	it("takes the choices on an Artifact that is not open to anyone yet, so they are there when it is", async () => {
		const { usecase, artifact, artifacts } = await build({ generalAccess: "restricted" })
		await usecase.setSettings(owner, { artifactId: artifact.id, download: false })
		expect(artifacts.settingsOf(artifact.id).download).toBe(false)
	})
})

describe("AnyoneUsecase.unlock", () => {
	const protectedArtifact = async () => {
		const ctx = await build()
		await ctx.usecase.setSettings(owner, { artifactId: ctx.artifact.id, passwordOn: true, password: "correct horse" })
		return ctx
	}

	it("trades the right password for a cookie value whose sha256 is the only thing stored, for the shared lifetime", async () => {
		const { usecase, unlocks, artifact } = await protectedArtifact()
		const issued = await usecase.unlock(anonymousReader(artifact.id), artifact.id, "correct horse")

		expect(issued.ttlSeconds).toBe(ANYONE_UNLOCK_TTL_SECONDS)
		expect(issued.ttlSeconds).toBe(24 * 60 * 60)
		expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(unlocks.rows).toEqual([
			{
				artifactId: artifact.id,
				tokenHash: hashUnlockToken(issued.token),
				expiresAt: new Date(NOW.getTime() + ANYONE_UNLOCK_TTL_SECONDS * 1000),
			},
		])
		expect(JSON.stringify(unlocks.rows)).not.toContain(issued.token)
	})

	it("answers a wrong password as INCORRECT_PASSWORD and stores nothing", async () => {
		const { usecase, unlocks, artifact } = await protectedArtifact()
		await expect(usecase.unlock(anonymousReader(artifact.id), artifact.id, "wrong horse")).rejects.toBeInstanceOf(
			IncorrectPasswordError,
		)
		expect(unlocks.rows).toHaveLength(0)
	})

	it("ledgers every attempt under the reader: a wrong password, a right one, and an address with no password", async () => {
		const { usecase, ledger, artifact } = await protectedArtifact()
		const reader = anonymousReader(artifact.id)
		await expect(usecase.unlock(reader, artifact.id, "wrong horse")).rejects.toBeInstanceOf(IncorrectPasswordError)
		await usecase.unlock(reader, artifact.id, "correct horse")
		await expect(usecase.unlock(anonymousReader("nothing-here"), "nothing-here", "x")).rejects.toBeInstanceOf(
			RefusalError,
		)

		const attempt = { principal: reader, surface: "web", action: "artifacts.unlock", artifactId: artifact.id }
		expect(ledger.recordCall.mock.calls.map(([call]) => call)).toEqual([
			{ ...attempt, reason: "incorrect-password" },
			{ ...attempt, reason: null },
			{ ...attempt, principal: anonymousReader("nothing-here"), artifactId: "nothing-here", reason: "out-of-boundary" },
		])
	})

	it("hands each right answer its own cookie value", async () => {
		const { usecase, artifact } = await protectedArtifact()
		const first = await usecase.unlock(anonymousReader(artifact.id), artifact.id, "correct horse")
		const second = await usecase.unlock(anonymousReader(artifact.id), artifact.id, "correct horse")
		expect(second.token).not.toBe(first.token)
	})

	it.each([
		["a missing Artifact", (ctx: Awaited<ReturnType<typeof build>>) => ({ id: "nothing-here", ctx })],
		[
			"a restricted Artifact",
			(ctx: Awaited<ReturnType<typeof build>>) => {
				ctx.artifact.generalAccess = "restricted"
				return { id: ctx.artifact.id, ctx }
			},
		],
		[
			"an Artifact with no password on",
			(ctx: Awaited<ReturnType<typeof build>>) => {
				ctx.artifacts.anyone.set(ctx.artifact.id, { ...ctx.artifacts.settingsOf(ctx.artifact.id), passwordOn: false })
				return { id: ctx.artifact.id, ctx }
			},
		],
		[
			"an expired address",
			(ctx: Awaited<ReturnType<typeof build>>) => {
				ctx.artifacts.anyone.set(ctx.artifact.id, {
					...ctx.artifacts.settingsOf(ctx.artifact.id),
					expiresAt: new Date(Date.now() - 1000),
				})
				return { id: ctx.artifact.id, ctx }
			},
		],
		[
			"a deleted Artifact",
			(ctx: Awaited<ReturnType<typeof build>>) => {
				ctx.artifact.deletedAt = new Date()
				return { id: ctx.artifact.id, ctx }
			},
		],
	])("refuses %s as one that does not exist, after the same argon2 work as a check", async (_name, arrange) => {
		const ctx = await protectedArtifact()
		const { id } = arrange(ctx)
		await expect(ctx.usecase.unlock(anonymousReader(id), id, "correct horse")).rejects.toBeInstanceOf(RefusalError)
		expect(ctx.hasher.verifyDummy).toHaveBeenCalledTimes(1)
		expect(ctx.hasher.verify).not.toHaveBeenCalled()
		expect(ctx.unlocks.rows).toHaveLength(0)
	})

	it("stores nothing when the password was replaced while it was being checked", async () => {
		const { usecase, unlocks, hasher, artifact, artifacts } = await protectedArtifact()
		hasher.verify.mockImplementationOnce(async (hash: string, plain: string) => {
			const matched = hash === `hashed:${plain}`
			await usecase.setSettings(owner, { artifactId: artifact.id, password: "replacement" })
			return matched
		})
		await expect(usecase.unlock(anonymousReader(artifact.id), artifact.id, "correct horse")).rejects.toBeInstanceOf(
			IncorrectPasswordError,
		)
		expect(unlocks.rows).toHaveLength(0)
		expect(artifacts.passwordHashes.get(artifact.id)).toBe("hashed:replacement")
	})
})
