process.env.TZ = "America/New_York"

import { describe, expect, it } from "vitest"

import { calendarDaysBetween } from "./calendarDays"

describe("calendarDaysBetween", () => {
	it("counts 2 across the Mar 8 2026 spring-forward, where midnight-to-midnight is 47h", () => {
		expect(calendarDaysBetween(new Date("2026-03-07T09:00:00"), new Date("2026-03-09T09:00:00"))).toBe(2)
	})

	it("counts 2 across the Nov 1 2026 fall-back, where midnight-to-midnight is 49h", () => {
		expect(calendarDaysBetween(new Date("2026-10-31T09:00:00"), new Date("2026-11-02T09:00:00"))).toBe(2)
	})
})
