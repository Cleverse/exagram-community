import { createHmac } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
	USERCONTENT_TOKEN_TTL_SECONDS,
	mintUsercontentToken,
	verifyUsercontentToken,
} from "./usercontent-token.service"

const SECRET = "a".repeat(32)
const NOW = 1_800_000_000

describe("usercontent tokens", () => {
	it("round-trips the revision id inside the TTL", () => {
		const token = mintUsercontentToken({ revisionId: "11111111-1111-1111-1111-111111111111" }, SECRET, {
			nowSeconds: NOW,
		})
		expect(verifyUsercontentToken(token, SECRET, NOW + 299)).toEqual({
			ok: true,
			revisionId: "11111111-1111-1111-1111-111111111111",
			callId: null,
		})
	})

	it("carries the ledger call a link page minted it under", () => {
		const token = mintUsercontentToken(
			{ revisionId: "11111111-1111-1111-1111-111111111111", callId: "33333333-3333-4333-8333-333333333333" },
			SECRET,
			{ nowSeconds: NOW },
		)
		expect(verifyUsercontentToken(token, SECRET, NOW)).toEqual({
			ok: true,
			revisionId: "11111111-1111-1111-1111-111111111111",
			callId: "33333333-3333-4333-8333-333333333333",
		})
	})

	it("scopes a preview token to one digest", () => {
		const previewSha256 = "a".repeat(64)
		const token = mintUsercontentToken({ revisionId: "11111111-1111-1111-1111-111111111111", previewSha256 }, SECRET, {
			nowSeconds: NOW,
		})
		expect(verifyUsercontentToken(token, SECRET, NOW)).toEqual({
			ok: true,
			revisionId: "11111111-1111-1111-1111-111111111111",
			callId: null,
			previewSha256,
		})
	})

	it("carries the Owner's no-download choice and says nothing when download is allowed", () => {
		const revisionId = "11111111-1111-1111-1111-111111111111"
		const withheld = mintUsercontentToken({ revisionId, noDownload: true }, SECRET, { nowSeconds: NOW })
		expect(verifyUsercontentToken(withheld, SECRET, NOW)).toEqual({
			ok: true,
			revisionId,
			callId: null,
			noDownload: true,
		})
		const allowed = verifyUsercontentToken(
			mintUsercontentToken({ revisionId }, SECRET, { nowSeconds: NOW }),
			SECRET,
			NOW,
		)
		expect(allowed).not.toHaveProperty("noDownload")
	})

	it("reads only a literal true as no-download, so a signed payload cannot carry a look-alike", () => {
		const body = Buffer.from(
			JSON.stringify({ revisionId: "11111111-1111-1111-1111-111111111111", noDownload: "true", exp: NOW + 300 }),
		).toString("base64url")
		const signed = createHmac("sha256", SECRET).update(body).digest("base64url")
		expect(verifyUsercontentToken(`${body}.${signed}`, SECRET, NOW)).not.toHaveProperty("noDownload")
	})

	it("honours the TTL it is given instead of the default", () => {
		expect(USERCONTENT_TOKEN_TTL_SECONDS).toBe(300)
		const token = mintUsercontentToken({ revisionId: "11111111-1111-1111-1111-111111111111" }, SECRET, {
			ttlSeconds: 60,
			nowSeconds: NOW,
		})
		expect(verifyUsercontentToken(token, SECRET, NOW + 61)).toEqual({ ok: false, reason: "expired" })
	})

	it("rejects the token one second past its TTL", () => {
		const token = mintUsercontentToken({ revisionId: "11111111-1111-1111-1111-111111111111" }, SECRET, {
			nowSeconds: NOW,
		})
		expect(verifyUsercontentToken(token, SECRET, NOW + 301)).toEqual({ ok: false, reason: "expired" })
	})

	it("rejects a wrong signature, a swapped payload and a malformed token", () => {
		const token = mintUsercontentToken({ revisionId: "11111111-1111-1111-1111-111111111111" }, SECRET, {
			nowSeconds: NOW,
		})
		const [payload, signature] = token.split(".")
		const forged = `${Buffer.from(
			JSON.stringify({ revisionId: "22222222-2222-2222-2222-222222222222", exp: NOW + 300 }),
		).toString("base64url")}.${signature}`

		expect(verifyUsercontentToken(token, "b".repeat(32), NOW)).toEqual({ ok: false, reason: "signature" })
		expect(verifyUsercontentToken(forged, SECRET, NOW)).toEqual({ ok: false, reason: "signature" })
		expect(verifyUsercontentToken(payload, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" })
		expect(verifyUsercontentToken(undefined, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" })
	})
})
