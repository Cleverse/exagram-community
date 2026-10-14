import { describe, expect, it } from "vitest"

import { ageLabel, editedLabel, formatSheetDate } from "./format"
import { PREVIEW_ZOOM, zoomIn, zoomOut } from "./zoom"

describe("formatSheetDate", () => {
	it("writes the prototype's kicker date, day first and a 24h clock", () => {
		expect(formatSheetDate(new Date(2026, 8, 11, 9, 12))).toBe("11 Sep 2026 · 09:12")
	})
})

describe("ageLabel", () => {
	const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000)

	it("writes the compact age with ago, and today for day zero", () => {
		expect(ageLabel(daysAgo(0))).toBe("today")
		expect(ageLabel(daysAgo(3))).toBe("3d ago")
		expect(ageLabel(daysAgo(14))).toBe("2w ago")
	})
})

describe("editedLabel", () => {
	const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

	it("reads minutes, then hours, inside the last day, and the compact age after it", () => {
		expect(editedLabel(minutesAgo(0))).toBe("1m ago")
		expect(editedLabel(minutesAgo(35))).toBe("35m ago")
		expect(editedLabel(minutesAgo(125))).toBe("2h ago")
		expect(editedLabel(minutesAgo(3 * 24 * 60))).toBe("3d ago")
		expect(editedLabel(minutesAgo(8 * 24 * 60))).toBe("1w ago")
	})
})

describe("zoom", () => {
	it("steps by 10 and stops at the prototype's 80 and 200", () => {
		expect(zoomIn(110)).toBe(120)
		expect(zoomOut(110)).toBe(100)
		expect(zoomIn(200)).toBe(200)
		expect(zoomOut(80)).toBe(80)
		expect(zoomOut(50, PREVIEW_ZOOM)).toBe(50)
		expect(zoomIn(200, PREVIEW_ZOOM)).toBe(200)
		expect(zoomOut(100, PREVIEW_ZOOM)).toBe(90)
	})
})
