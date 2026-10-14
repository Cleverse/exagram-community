import { anonymousReader } from "@exagram/core/entity/principal"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { ServeService } from "@exagram/core/services/serve/serve.service"
import { inlineTx } from "@exagram/core/test/tx"
import { AnyoneExpiredError, PasswordRequiredError } from "@exagram/core/utils/errors"
import { RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it, vi } from "vitest"

import type { LedgerDatagateway } from "@exagram/core/datagateway/ledger.datagateway"

import { FakeArtifactsDatagateway, FakeVisibilityDatagateway } from "./store.datagateway.fake"

const UNLOCK = "a".repeat(64)
const OWNER = { kind: "user" as const, id: "owner", workspaceId: "w1" }
const STRANGER = { kind: "user" as const, id: "stranger", workspaceId: "w2" }

const build = async () => {
	const artifacts = new FakeArtifactsDatagateway()
	const artifact = await artifacts.create({
		workspaceId: "w1",
		ownerId: OWNER.id,
		projectId: null,
		kind: "doc",
		title: "Plan",
	})
	artifact.currentRevisionId = "rev-1"
	await artifacts.setGeneralAccess(artifact.id, OWNER.id, "anyone")
	const gateway = {
		startCall: vi.fn().mockResolvedValue("call-1"),
		recordServe: vi.fn().mockResolvedValue(undefined),
		markDelivered: vi.fn().mockResolvedValue(undefined),
		markFailed: vi.fn().mockResolvedValue(undefined),
		setBodyDigest: vi.fn().mockResolvedValue(undefined),
		listForArtifact: vi.fn().mockResolvedValue([]),
		listActivity: vi.fn().mockResolvedValue([]),
		listArtifactViewers: vi.fn().mockResolvedValue([]),
	} satisfies LedgerDatagateway
	const serve = new ServeService(new FakeVisibilityDatagateway(artifacts), new LedgerService(gateway), inlineTx())
	const read = (principal: typeof OWNER | typeof STRANGER | ReturnType<typeof anonymousReader>, unlockHash?: string) =>
		serve.resolve({
			principal,
			surface: "web",
			action: "artifacts.get",
			artifactId: artifact.id,
			requireRevision: true,
			unlockHash,
		})
	return { artifacts, artifact, gateway, read }
}

describe("the in-memory boundary, with a password and expiry on Anyone with the link", () => {
	it("holds a password-protected file back until a live unlock is presented, and never from the Owner", async () => {
		const { artifacts, artifact, gateway, read } = await build()
		await artifacts.setAnyoneSettings(artifact.id, OWNER.id, { passwordOn: true, passwordHash: "hash" })

		for (const reader of [STRANGER, anonymousReader(artifact.id)]) {
			await expect(read(reader)).rejects.toBeInstanceOf(PasswordRequiredError)
			await expect(read(reader, UNLOCK)).rejects.toBeInstanceOf(PasswordRequiredError)
		}
		expect(gateway.recordServe).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "password-required" }))

		artifacts.unlocks.add(`${artifact.id}:${UNLOCK}`)
		await expect(read(STRANGER, UNLOCK)).resolves.toMatchObject({ access: "view" })
		await expect(read(anonymousReader(artifact.id), UNLOCK)).resolves.toMatchObject({ access: "view" })
		await expect(read(OWNER)).resolves.toMatchObject({ access: "owner" })
	})

	it("answers an expired address by name, and reopens it when the expiry is cleared", async () => {
		const { artifacts, artifact, gateway, read } = await build()
		await artifacts.setAnyoneSettings(artifact.id, OWNER.id, { expiresAt: new Date(Date.now() - 1000) })
		await expect(read(STRANGER)).rejects.toBeInstanceOf(AnyoneExpiredError)
		expect(gateway.recordServe).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "expired" }))
		await expect(read(OWNER)).resolves.toMatchObject({ access: "owner" })

		await artifacts.setAnyoneSettings(artifact.id, OWNER.id, { expiresAt: null })
		await expect(read(STRANGER)).resolves.toMatchObject({ access: "view" })
	})

	it("names no gate for an Artifact that is not open to anyone", async () => {
		const { artifacts, artifact, read } = await build()
		await artifacts.setAnyoneSettings(artifact.id, OWNER.id, { passwordOn: true, passwordHash: "hash" })
		await artifacts.setGeneralAccess(artifact.id, OWNER.id, "restricted")
		await expect(read(STRANGER)).rejects.toBeInstanceOf(RefusalError)
	})

	it("withholds download from the tier's readers only", async () => {
		const { artifacts, artifact } = await build()
		await artifacts.setAnyoneSettings(artifact.id, OWNER.id, { download: false })
		expect(await artifacts.getVisible(STRANGER, artifact.id)).toMatchObject({ canDownload: false })
		expect(await artifacts.getVisible(OWNER, artifact.id)).toMatchObject({ canDownload: true })
		artifacts.extraAccess.set(`${STRANGER.id}:${artifact.id}`, "view")
		expect(await artifacts.getVisible(STRANGER, artifact.id)).toMatchObject({ canDownload: true })
	})

	it("lets only the Owner change the settings, and refuses a password switched on before one is stored", async () => {
		const { artifacts, artifact } = await build()
		expect(await artifacts.setAnyoneSettings(artifact.id, STRANGER.id, { download: false })).toBe(false)
		await expect(artifacts.setAnyoneSettings(artifact.id, OWNER.id, { passwordOn: true })).rejects.toThrow()

		await artifacts.setAnyoneSettings(artifact.id, OWNER.id, { passwordHash: "hash" })
		await artifacts.setAnyoneSettings(artifact.id, OWNER.id, { passwordOn: true })
		expect(await artifacts.getVisible(OWNER, artifact.id)).toMatchObject({
			anyoneSettings: { passwordOn: true, passwordSet: true, expiresAt: null, download: true },
		})
	})
})
