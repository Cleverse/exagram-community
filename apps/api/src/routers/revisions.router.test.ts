import { hashUnlockToken } from "@exagram/core/services/unlock-token.service"
import { describe, expect, it } from "vitest"

import { createRateCounter } from "../mcp/rate"

import { artifactId, build, owner, revisionId } from "./revisions.router.harness"

describe("GET /artifacts/{artifactId}/revisions/{revisionId}/text", () => {
	it("hands the signed-in person, the Artifact and the named Revision to the usecase", async () => {
		const { revisionText, clientFor } = build()
		await expect(clientFor(owner).revisionText({ params: { artifactId, revisionId } })).resolves.toEqual({
			result: { revisionId, mime: "text/markdown", text: "one" },
		})
		expect(revisionText).toHaveBeenCalledWith(owner, artifactId, revisionId, undefined)
	})

	it("rejects a revision id that is not a UUID before the usecase runs", async () => {
		const { revisionText, clientFor } = build()
		await expect(
			clientFor(owner).revisionText({ params: { artifactId, revisionId: "not-a-uuid" } }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(revisionText).not.toHaveBeenCalled()
	})

	it("refuses a request with no signed-in person", async () => {
		const { revisionText, clientFor } = build()
		await expect(clientFor(undefined).revisionText({ params: { artifactId, revisionId } })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		})
		expect(revisionText).not.toHaveBeenCalled()
	})
})

describe("POST /{artifactId}/revisions/{revisionId}/body-token", () => {
	it("hands the signed-in person (with the Workspace their session acts in), the Artifact and the named Revision to the usecase", async () => {
		const { bodyTokenAt, clientFor } = build()
		await expect(clientFor(owner).bodyTokenAt({ params: { artifactId, revisionId } })).resolves.toEqual({
			result: { revisionId, url: "https://uc.exagram.test/uc/t", expiresInSeconds: 300 },
		})
		expect(bodyTokenAt).toHaveBeenCalledWith(owner, artifactId, revisionId, undefined)
	})

	it("rejects a revision id that is not a UUID before the usecase runs", async () => {
		const { bodyTokenAt, clientFor } = build()
		await expect(
			clientFor(owner).bodyTokenAt({ params: { artifactId, revisionId: "not-a-uuid" } }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(bodyTokenAt).not.toHaveBeenCalled()
	})

	it("refuses a request with no signed-in person", async () => {
		const { bodyTokenAt, clientFor } = build()
		await expect(clientFor(undefined).bodyTokenAt({ params: { artifactId, revisionId } })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		})
		expect(bodyTokenAt).not.toHaveBeenCalled()
	})
})

describe("POST /{artifactId}/preview-token", () => {
	it("hands the signed-in person, with the Workspace their session acts in, to the usecase", async () => {
		const { previewToken, clientFor } = build()
		await clientFor(owner).previewToken({ params: { artifactId } })
		expect(previewToken).toHaveBeenCalledWith(owner, artifactId, undefined)
	})
})

describe("the unlock cookie (ADR 0044)", () => {
	const other = "55555555-5555-4555-8555-555555555555"
	const cookie = `exagram_unlock_${other}=other-value; exagram_unlock_${artifactId}=the-cookie-value`
	const hash = hashUnlockToken("the-cookie-value")

	it("reaches every artifact-scoped read as the sha256 of this Artifact's cookie", async () => {
		const { text, revisionText, bodyToken, bodyTokenAt, previewToken, clientFor } = build()
		await clientFor(owner, undefined, cookie).text({ params: { artifactId } })
		await clientFor(owner, undefined, cookie).bodyToken({ params: { artifactId } })
		await clientFor(owner, undefined, cookie).revisionText({ params: { artifactId, revisionId } })
		await clientFor(owner, undefined, cookie).bodyTokenAt({ params: { artifactId, revisionId } })
		await clientFor(owner, undefined, cookie).previewToken({ params: { artifactId } })

		expect(text.mock.calls.map((call: unknown[]) => call[2])).toEqual([hash])
		expect(bodyToken.mock.calls.map((call: unknown[]) => call[2])).toEqual([hash])
		expect(revisionText.mock.calls.map((call: unknown[]) => call[3])).toEqual([hash])
		expect(bodyTokenAt.mock.calls.map((call: unknown[]) => call[3])).toEqual([hash])
		expect(previewToken.mock.calls.map((call: unknown[]) => call[2])).toEqual([hash])
	})

	it("sends nothing for an Artifact the cookie jar holds no cookie for", async () => {
		const { text, clientFor } = build()
		await clientFor(owner, undefined, `exagram_unlock_${other}=other-value`).text({ params: { artifactId } })
		expect(text.mock.calls.map((call: unknown[]) => call[2])).toEqual([undefined])
	})
})

describe("signed-out reads (ADR 0042)", () => {
	it("reads text and mints a body token as the anonymous reader of that Artifact", async () => {
		const { text, bodyToken, clientFor } = build(createRateCounter(100))
		await expect(clientFor(null).text({ params: { artifactId } })).resolves.toMatchObject({
			result: { revisionId, text: "one" },
		})
		expect(text).toHaveBeenCalledWith({ kind: "anonymous", id: artifactId }, artifactId, undefined)
		await expect(clientFor(null).bodyToken({ params: { artifactId } })).resolves.toMatchObject({
			result: { revisionId },
		})
		expect(bodyToken).toHaveBeenCalledWith({ kind: "anonymous", id: artifactId }, artifactId, undefined)
	})

	it("reads as the session's user when there is one", async () => {
		const { text, bodyToken, clientFor } = build(createRateCounter(100))
		await clientFor(owner).text({ params: { artifactId } })
		expect(text).toHaveBeenCalledWith(
			{ kind: "user", id: owner.id, workspaceId: owner.workspaceId },
			artifactId,
			undefined,
		)
		await clientFor(owner).bodyToken({ params: { artifactId } })
		expect(bodyToken).toHaveBeenCalledWith(
			{ kind: "user", id: owner.id, workspaceId: owner.workspaceId },
			artifactId,
			undefined,
		)
	})

	it("spends one per-IP budget across text and bodyToken, before any Artifact is looked at", async () => {
		const { text, bodyToken, clientFor } = build(createRateCounter(2))
		const other = "55555555-5555-4555-8555-555555555555"
		await expect(clientFor(null).text({ params: { artifactId } })).resolves.toBeDefined()
		await expect(clientFor(null).bodyToken({ params: { artifactId: other } })).resolves.toBeDefined()
		// The third call names a different id and is refused the same: the budget never looks at the Artifact.
		await expect(clientFor(null).text({ params: { artifactId: other } })).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		})
		await expect(clientFor(null).bodyToken({ params: { artifactId } })).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		})
		expect(text).toHaveBeenCalledTimes(1)
		expect(bodyToken).toHaveBeenCalledTimes(1)
		// Another address, and a session on the exhausted one, both still read.
		await expect(clientFor(null, "198.51.100.9").text({ params: { artifactId } })).resolves.toBeDefined()
		await expect(clientFor(owner).text({ params: { artifactId } })).resolves.toBeDefined()
		expect(text).toHaveBeenCalledTimes(3)
	})
})

describe("the unlock cookie signed out (ADR 0044)", () => {
	const other = "55555555-5555-4555-8555-555555555555"
	const cookie = `exagram_unlock_${other}=other-value; exagram_unlock_${artifactId}=the-cookie-value`
	const hash = hashUnlockToken("the-cookie-value")

	it("reaches text and bodyToken as the sha256 of this Artifact's cookie, signed in or not", async () => {
		const { text, bodyToken, clientFor } = build(createRateCounter(100))
		await clientFor(null, undefined, cookie).text({ params: { artifactId } })
		await clientFor(owner, undefined, cookie).text({ params: { artifactId } })
		await clientFor(null, undefined, cookie).bodyToken({ params: { artifactId } })

		expect(text.mock.calls.map((call: unknown[]) => call[2])).toEqual([hash, hash])
		expect(bodyToken.mock.calls.map((call: unknown[]) => call[2])).toEqual([hash])
	})

	it("sends nothing for an Artifact the cookie jar holds no cookie for", async () => {
		const { text, clientFor } = build(createRateCounter(100))
		await clientFor(null, undefined, `exagram_unlock_${other}=other-value`).text({ params: { artifactId } })
		expect(text.mock.calls.map((call: unknown[]) => call[2])).toEqual([undefined])
	})
})
