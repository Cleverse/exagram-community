import { describe, expect, it, vi } from "vitest"

import { inlineTx } from "../../test/tx"
import { AnyoneExpiredError, PasswordRequiredError } from "../../utils/errors"
import { REFUSAL_TEXT, RefusalError } from "../../utils/refusal"
import { LedgerService } from "../ledger/ledger.service"

import { ServeService } from "./serve.service"

import type { RevisionTextReader } from "./serve.port"
import type { LedgerDatagateway } from "../../datagateway/ledger.datagateway"
import type { VisibilityDatagateway } from "../../datagateway/visibility.datagateway"
import type { AnyoneGate } from "../../entity/artifact"

const ARTIFACT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const REVISION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const WORKSPACE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const PRINCIPAL = { kind: "user" as const, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", workspaceId: WORKSPACE }

const build = (
	visible: Awaited<ReturnType<VisibilityDatagateway["getVisible"]>>,
	gate: AnyoneGate | null = null,
	revisionText?: RevisionTextReader,
) => {
	const rows: unknown[] = []
	const gateway: LedgerDatagateway = {
		startCall: vi.fn().mockResolvedValue("call-1"),
		recordServe: vi.fn().mockImplementation((row) => {
			rows.push(row)
			return Promise.resolve()
		}),
		markDelivered: vi.fn().mockImplementation((callId: string, bodySha256?: string | null) => {
			rows.push({ callId, status: "delivered", bodySha256: bodySha256 ?? null })
			return Promise.resolve()
		}),
		markFailed: vi.fn().mockImplementation((callId: string) => {
			rows.push({ callId, status: "failed", bodySha256: null })
			return Promise.resolve()
		}),
		setBodyDigest: vi.fn().mockImplementation((callId: string, bodySha256: string) => {
			rows.push({ callId, bodySha256 })
			return Promise.resolve()
		}),
		listForArtifact: vi.fn().mockResolvedValue([]),
		listActivity: vi.fn().mockResolvedValue([]),
		listArtifactViewers: vi.fn().mockResolvedValue([]),
	}
	const visibility = {
		listVisible: vi.fn().mockResolvedValue(visible === null ? [] : [visible]),
		getVisible: vi.fn().mockResolvedValue(visible),
		anyoneGate: vi.fn().mockResolvedValue(gate),
		listPendingRevisions: vi.fn().mockResolvedValue([]),
	} satisfies VisibilityDatagateway
	// `serve()` hands `fn` the open connection; these tests never issue SQL through it.
	const tx = { ...inlineTx(), current: () => ({}) as ReturnType<ReturnType<typeof inlineTx>["current"]> }
	const service = new ServeService(visibility, new LedgerService(gateway), tx, undefined, revisionText)
	return { service, gateway, rows, visibility }
}

describe("ServeService.resolve", () => {
	it("serves the revision the boundary resolved and ledgers it", async () => {
		const { service, rows } = build({ artifactId: ARTIFACT, revisionId: REVISION, access: "view", download: true })
		const result = await service.resolve({
			principal: PRINCIPAL,
			surface: "web",
			action: "revisions.text",
			artifactId: ARTIFACT,
			requireRevision: true,
		})
		expect(result).toEqual({ callId: "call-1", artifactId: ARTIFACT, revisionId: REVISION, access: "view" })
		expect(rows[0]).toEqual({
			callId: "call-1",
			artifactId: ARTIFACT,
			revisionId: REVISION,
			outcome: "served",
			reason: null,
			form: null,
			detectorVersion: null,
		})
		expect(rows[1]).toEqual({ callId: "call-1", status: "delivered", bodySha256: null })
	})

	it("withholds with the uniform sentence when the boundary returns nothing", async () => {
		const { service, rows } = build(null)
		await expect(
			service.resolve({
				principal: PRINCIPAL,
				surface: "web",
				action: "artifacts.get",
				artifactId: ARTIFACT,
				requireRevision: false,
			}),
		).rejects.toThrow(REFUSAL_TEXT)
		expect(rows[0]).toEqual({
			callId: "call-1",
			artifactId: ARTIFACT,
			revisionId: null,
			outcome: "withheld",
			reason: "out-of-boundary",
			form: null,
			detectorVersion: null,
		})
		expect(rows[1]).toEqual({ callId: "call-1", status: "failed", bodySha256: null })
	})

	it("withholds a boundary row with no approved revision when a revision is required", async () => {
		const { service, rows } = build({ artifactId: ARTIFACT, revisionId: null, access: "owner", download: true })
		await expect(
			service.resolve({
				principal: PRINCIPAL,
				surface: "web",
				action: "revisions.text",
				artifactId: ARTIFACT,
				requireRevision: true,
			}),
		).rejects.toThrow(REFUSAL_TEXT)
		expect(rows[0]).toMatchObject({ outcome: "withheld", reason: "no-approved-revision" })
	})

	it("lets an owner see their own artifact that has no approved revision yet", async () => {
		const { service } = build({ artifactId: ARTIFACT, revisionId: null, access: "owner", download: true })
		const result = await service.resolve({
			principal: PRINCIPAL,
			surface: "web",
			action: "artifacts.get",
			artifactId: ARTIFACT,
			requireRevision: false,
		})
		expect(result.revisionId).toBeNull()
		expect(result.access).toBe("owner")
	})
})

describe("ServeService.resolveList", () => {
	it("opens one call and writes one serve row per artifact listed", async () => {
		const { service, rows } = build(null)
		const listed = [
			{ id: ARTIFACT, visibleRevisionId: REVISION },
			{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", visibleRevisionId: null },
		]
		const result = await service.resolveList({
			principal: PRINCIPAL,
			surface: "web",
			action: "artifacts.list",
			resolve: () => Promise.resolve(listed),
			toServe: (row) => ({ artifactId: row.id, revisionId: row.visibleRevisionId }),
		})
		expect(result.rows).toBe(listed)
		expect(rows).toHaveLength(3)
		expect(rows[0]).toMatchObject({ artifactId: ARTIFACT, outcome: "served" })
		expect(rows[1]).toMatchObject({ artifactId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", outcome: "served" })
		expect(rows[2]).toEqual({ callId: "call-1", status: "delivered", bodySha256: null })
	})
})

describe("ServeService.serve", () => {
	const input = {
		principal: PRINCIPAL,
		surface: "web" as const,
		action: "revisions.revisionText",
		artifactId: ARTIFACT,
	}
	const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

	it("records the Revision a named read asked for on the served row", async () => {
		const { service, rows } = build({ artifactId: ARTIFACT, revisionId: REVISION, access: "owner", download: true })
		await expect(service.serve({ ...input, revisionId: OTHER }, () => Promise.resolve("ok"))).resolves.toBe("ok")
		expect(rows[0]).toMatchObject({ revisionId: OTHER, outcome: "served" })
	})

	it("records no Revision when a named read is refused inside fn", async () => {
		const { service, rows } = build({ artifactId: ARTIFACT, revisionId: REVISION, access: "view", download: true })
		await expect(
			service.serve({ ...input, revisionId: OTHER }, () => Promise.reject(new RefusalError())),
		).rejects.toThrow(REFUSAL_TEXT)
		expect(rows[0]).toMatchObject({ revisionId: null, outcome: "withheld", reason: "refused-in-serve" })
	})

	it("keeps the resolved Revision on the refusal of a plain read", async () => {
		const { service, rows } = build({ artifactId: ARTIFACT, revisionId: REVISION, access: "view", download: true })
		await expect(service.serve(input, () => Promise.reject(new RefusalError()))).rejects.toThrow(REFUSAL_TEXT)
		expect(rows[0]).toMatchObject({ revisionId: REVISION, outcome: "withheld", reason: "refused-in-serve" })
	})

	it("withholds an Artifact with nothing approved before fn runs when a Revision is required", async () => {
		const { service, rows } = build({ artifactId: ARTIFACT, revisionId: null, access: "owner", download: true })
		const fn = vi.fn(() => Promise.resolve("never"))
		await expect(service.serve({ ...input, requireRevision: true }, fn)).rejects.toThrow(REFUSAL_TEXT)
		expect(fn).not.toHaveBeenCalled()
		expect(rows[0]).toMatchObject({ revisionId: null, outcome: "withheld", reason: "no-approved-revision" })
	})

	it("writes no served row when fn fails with something other than a refusal", async () => {
		const { service, rows } = build({ artifactId: ARTIFACT, revisionId: REVISION, access: "owner", download: true })
		await expect(service.serve(input, () => Promise.reject(new Error("bad request")))).rejects.toThrow("bad request")
		expect(rows).not.toContainEqual(expect.objectContaining({ outcome: "served" }))
	})
})

describe("ServeService and the anyone gate", () => {
	const UNLOCK = "f".repeat(64)
	const read = { principal: PRINCIPAL, surface: "web" as const, action: "artifacts.get", artifactId: ARTIFACT }

	it.each([
		["password", PasswordRequiredError, "password-required", "Enter the password to open this file."],
		["expired", AnyoneExpiredError, "expired", "This link has expired. Ask the owner for a new one."],
	] as const)(
		"answers a %s gate by name from resolve and ledgers its own reason",
		async (gate, error, reason, text) => {
			const { service, rows } = build(null, gate)
			const attempt = service.resolve({ ...read, requireRevision: false })
			await expect(attempt).rejects.toBeInstanceOf(error)
			await expect(attempt).rejects.toThrow(text)
			expect(rows[0]).toEqual({
				callId: "call-1",
				artifactId: ARTIFACT,
				revisionId: null,
				outcome: "withheld",
				reason,
				form: null,
				detectorVersion: null,
			})
			expect(rows[1]).toEqual({ callId: "call-1", status: "failed", bodySha256: null })
		},
	)

	it("answers a gate from serve before fn runs", async () => {
		const { service, rows } = build(null, "password")
		const fn = vi.fn(() => Promise.resolve("never"))
		await expect(service.serve(read, fn)).rejects.toBeInstanceOf(PasswordRequiredError)
		expect(fn).not.toHaveBeenCalled()
		expect(rows[0]).toMatchObject({ outcome: "withheld", reason: "password-required" })
	})

	it("forwards the unlock hash to the boundary and to the gate, and asks the gate only after a miss", async () => {
		const found = build({ artifactId: ARTIFACT, revisionId: REVISION, access: "view", download: true })
		await found.service.resolve({ ...read, requireRevision: true, unlockHash: UNLOCK })
		expect(found.visibility.getVisible).toHaveBeenCalledWith(PRINCIPAL, ARTIFACT, { unlockHash: UNLOCK })
		expect(found.visibility.anyoneGate).not.toHaveBeenCalled()

		const missed = build(null, "password")
		await expect(
			missed.service.serve({ ...read, boundary: "commentable", unlockHash: UNLOCK }, vi.fn()),
		).rejects.toThrow()
		expect(missed.visibility.getVisible).toHaveBeenCalledWith(PRINCIPAL, ARTIFACT, {
			boundary: "commentable",
			unlockHash: UNLOCK,
		})
		expect(missed.visibility.anyoneGate).toHaveBeenCalledWith(PRINCIPAL, ARTIFACT, UNLOCK)
	})

	it("refuses with the uniform sentence when the gate says nothing, and when the Revision is the problem", async () => {
		const plain = build(null, null)
		await expect(plain.service.resolve({ ...read, requireRevision: false })).rejects.toThrow(REFUSAL_TEXT)
		expect(plain.rows[0]).toMatchObject({ reason: "out-of-boundary" })

		const bodyless = build({ artifactId: ARTIFACT, revisionId: null, access: "owner", download: true }, "password")
		await expect(bodyless.service.resolve({ ...read, requireRevision: true })).rejects.toThrow(REFUSAL_TEXT)
		expect(bodyless.visibility.anyoneGate).not.toHaveBeenCalled()
	})

	it("answers a gated text read with null, as it does a refused one", async () => {
		const readText = vi.fn()
		const { service } = build(null, "expired", { readText })
		await expect(service.resolveRevisionText({ ...read, unlockHash: UNLOCK })).resolves.toBeNull()
		expect(readText).not.toHaveBeenCalled()
	})

	it("hands the text reader the unlock hash its own boundary lookup needs", async () => {
		const readText = vi.fn().mockResolvedValue({ kind: "doc", mime: "text/markdown", text: "hello" })
		const { service } = build({ artifactId: ARTIFACT, revisionId: REVISION, access: "view", download: true }, null, {
			readText,
		})
		await service.resolveRevisionText({ ...read, unlockHash: UNLOCK })
		expect(readText).toHaveBeenCalledWith({
			principal: PRINCIPAL,
			artifactId: ARTIFACT,
			revisionId: REVISION,
			unlockHash: UNLOCK,
		})
	})

	it("hands resolveUnledgered the unlock hash", async () => {
		const { service, visibility } = build({
			artifactId: ARTIFACT,
			revisionId: REVISION,
			access: "owner",
			download: true,
		})
		await service.resolveUnledgered(PRINCIPAL, ARTIFACT, UNLOCK)
		expect(visibility.getVisible).toHaveBeenCalledWith(PRINCIPAL, ARTIFACT, { unlockHash: UNLOCK })
	})
})
