import { describe, expect, it } from "vitest"

import { isScrolled, pageHeaderSize } from "./pageHeader"

describe("pageHeaderSize", () => {
	it.each([
		{ tall: true, scrolled: false, size: { fontSize: 32, tracking: "-.02em", paddingTop: 32, tabsGap: 24 } },
		{ tall: false, scrolled: false, size: { fontSize: 24, tracking: "-.015em", paddingTop: 24, tabsGap: 16 } },
		{ tall: true, scrolled: true, size: { fontSize: 24, tracking: "-.015em", paddingTop: 16, tabsGap: 12 } },
		{ tall: false, scrolled: true, size: { fontSize: 22, tracking: "-.015em", paddingTop: 16, tabsGap: 12 } },
	])("tall $tall, scrolled $scrolled", ({ tall, scrolled, size }) => {
		expect(pageHeaderSize({ tall, scrolled })).toEqual(size)
	})
})

describe("isScrolled", () => {
	it("compacts only once the list is past 24px", () => {
		expect(isScrolled(0)).toBe(false)
		expect(isScrolled(24)).toBe(false)
		expect(isScrolled(25)).toBe(true)
	})
})
