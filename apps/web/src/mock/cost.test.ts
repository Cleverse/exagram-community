import { describe, expect, it } from "vitest"

import { cost, costBreakdown, tokens, usd } from "./cost"

describe("cost", () => {
	it("prices a request from tokens in, tokens out and redacted spans", () => {
		expect(cost(6120, 0, 2)).toBeCloseTo(6120 * 0.0000025 + 2 * 0.0012, 10)
		expect(cost(0, 0, 0)).toBe(0)
	})
})

describe("usd", () => {
	it("keeps three decimals and spells a free request out", () => {
		expect(usd(0)).toBe("$0.000")
		expect(usd(cost(9840, 620, 4))).toBe("$0.036")
	})
})

describe("tokens", () => {
	it("switches to thousands at 1000", () => {
		expect(tokens(940)).toBe("940")
		expect(tokens(52_600)).toBe("52.6k")
	})
})

describe("costBreakdown", () => {
	// The parts are rounded independently, so they need not add up to the total — as in the README.
	it("splits the total into redaction and serving", () => {
		expect(costBreakdown(6120, 0, 2)).toBe("$0.018 · redaction $0.002 · serving $0.015")
	})

	it("leaves redaction out of the parts and the total when redaction is off", () => {
		expect(costBreakdown(6120, 0, 2, false)).toBe("$0.015 · serving $0.015")
	})
})
