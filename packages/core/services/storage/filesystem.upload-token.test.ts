import { describe, expect, it } from "vitest"

import { UploadTokenSigner } from "./filesystem.upload-token"

const secret = "0123456789abcdef0123456789abcdef"
const payload = { storageKey: "artifacts/a/b", bytes: 1234, mime: "application/pdf", expiresAt: 10_000 }

describe("UploadTokenSigner", () => {
	it("round-trips a payload before it expires", () => {
		const tokens = new UploadTokenSigner(secret)
		expect(tokens.verify(tokens.sign(payload), 9_999)).toEqual(payload)
	})

	it("refuses an expired token", () => {
		const tokens = new UploadTokenSigner(secret)
		expect(tokens.verify(tokens.sign(payload), 10_000)).toBeNull()
	})

	it("refuses a token signed with another secret", () => {
		const token = new UploadTokenSigner("another-secret-another-secret-00").sign(payload)
		expect(new UploadTokenSigner(secret).verify(token, 0)).toBeNull()
	})

	it("refuses a payload changed after signing", () => {
		const tokens = new UploadTokenSigner(secret)
		const [, mac] = tokens.sign(payload).split(".")
		const forged = Buffer.from(JSON.stringify({ ...payload, bytes: 999_999 })).toString("base64url")
		expect(tokens.verify(`${forged}.${mac}`, 0)).toBeNull()
	})

	it("refuses a tampered or truncated MAC and malformed tokens", () => {
		const tokens = new UploadTokenSigner(secret)
		const token = tokens.sign(payload)
		const [body, mac] = token.split(".") as [string, string]
		const flipped = `${mac[0] === "A" ? "B" : "A"}${mac.slice(1)}`
		expect(tokens.verify(`${body}.${flipped}`, 0)).toBeNull()
		expect(tokens.verify(`${body}.${mac.slice(0, 10)}`, 0)).toBeNull()
		expect(tokens.verify(body, 0)).toBeNull()
		expect(tokens.verify(`${token}.extra`, 0)).toBeNull()
		expect(tokens.verify("", 0)).toBeNull()
	})

	it("refuses a correctly signed payload of the wrong shape", () => {
		const tokens = new UploadTokenSigner(secret)
		const token = tokens.sign({ ...payload, bytes: "1234" } as unknown as typeof payload)
		expect(tokens.verify(token, 0)).toBeNull()
	})
})
