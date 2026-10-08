import { ORPCError } from "@orpc/server"
import { describe, expect, it } from "vitest"

import { checkSameOrigin } from "./consent.router"

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
