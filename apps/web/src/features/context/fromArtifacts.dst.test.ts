import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { agePhrase } from "./fromArtifacts"

// New York springs forward on 8 Mar 2026: that local day is 23 hours long, so a millisecond count would
// call 9 Mar 00:00 "0 days" after 8 Mar 00:00. Node honours a runtime change of TZ.
const previous = process.env.TZ

beforeAll(() => {
	process.env.TZ = "America/New_York"
})

afterAll(() => {
	process.env.TZ = previous
})

describe("agePhrase across a DST change", () => {
	it("counts the 23-hour spring-forward day as one whole day", () => {
		const before = new Date(2026, 2, 8, 0, 0)
		const after = new Date(2026, 2, 9, 0, 0)
		expect(after.getTime() - before.getTime()).toBe(23 * 3_600_000)
		expect(agePhrase(before, after)).toBe("1d")
		expect(agePhrase(new Date(2026, 2, 7, 23, 30), new Date(2026, 2, 10, 0, 30))).toBe("3d")
	})

	it("counts the 25-hour fall-back day as one whole day", () => {
		expect(agePhrase(new Date(2026, 10, 1, 0, 0), new Date(2026, 10, 2, 0, 0))).toBe("1d")
	})
})
