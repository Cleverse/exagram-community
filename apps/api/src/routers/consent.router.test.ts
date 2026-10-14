import { ConsentInteractionGoneError } from "@exagram/core/utils/errors"
import { call, ORPCError } from "@orpc/server"
import { describe, expect, it, vi } from "vitest"

import { checkSameOrigin, createConsentRouter } from "./consent.router"

const WEB_ORIGIN = "https://exagram.example"

describe("checkSameOrigin", () => {
	it("refuses a request whose Origin header disagrees with the web origin", () => {
		expect(() => checkSameOrigin({ origin: "https://evil.example" }, WEB_ORIGIN)).toThrow(ORPCError)
	})

	it("allows a request with no Origin or Sec-Fetch-Site header", () => {
		expect(() => checkSameOrigin({}, WEB_ORIGIN)).not.toThrow()
	})

	it("allows a request whose Origin header matches the web origin", () => {
		expect(() => checkSameOrigin({ origin: WEB_ORIGIN }, WEB_ORIGIN)).not.toThrow()
	})

	it("refuses a request with Sec-Fetch-Site: cross-site even without an Origin header", () => {
		expect(() => checkSameOrigin({ "sec-fetch-site": "cross-site" }, WEB_ORIGIN)).toThrow(ORPCError)
	})
})

describe("createConsentRouter", () => {
	const user = { id: "u", workspaceId: "w" }
	const callInfo = (info: () => Promise<unknown>, warn: () => void) =>
		call(
			createConsentRouter({ consentUsecase: { info } as never, webOrigin: WEB_ORIGIN }).info,
			{ params: { uid: "uid-1" } },
			{ context: { headers: {}, ip: "", requestId: "r", user, raw: {}, log: { warn } } as never },
		)

	it("logs a warning when the interaction is gone", async () => {
		const warn = vi.fn()
		const gone = new ConsentInteractionGoneError("interaction session id cookie not found")

		await expect(callInfo(() => Promise.reject(gone), warn)).rejects.toBe(gone)

		expect(warn).toHaveBeenCalledExactlyOnceWith(
			{ event: "consent:interaction-gone", reason: "interaction session id cookie not found" },
			expect.any(String),
		)
	})

	it("logs nothing for any other failure", async () => {
		const warn = vi.fn()
		await expect(callInfo(() => Promise.reject(new Error("boom")), warn)).rejects.toThrow("boom")
		expect(warn).not.toHaveBeenCalled()
	})
})
