import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createRateCounter } from "./rate"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("createRateCounter", () => {
	it("allows the budget and refuses the next call in the same minute", () => {
		const counter = createRateCounter(3)
		expect(counter.take("c1")).toBe(true)
		expect(counter.take("c1")).toBe(true)
		expect(counter.take("c1")).toBe(true)
		expect(counter.take("c1")).toBe(false)
	})

	it("counts each connection separately", () => {
		const counter = createRateCounter(1)
		expect(counter.take("c1")).toBe(true)
		expect(counter.take("c2")).toBe(true)
		expect(counter.take("c1")).toBe(false)
	})

	it("refills after the window", () => {
		const counter = createRateCounter(1)
		expect(counter.take("c1")).toBe(true)
		vi.advanceTimersByTime(60_001)
		expect(counter.take("c1")).toBe(true)
	})

	it("admits new keys at the cap by evicting the oldest window", () => {
		const counter = createRateCounter(2)
		for (let index = 0; index < 10_000; index += 1) {
			expect(counter.take(`c${index}`)).toBe(true)
		}
		expect(counter.take("new")).toBe(true)
		expect(counter.take("c1")).toBe(true)
		expect(counter.take("c1")).toBe(false)
		expect(counter.take("c0")).toBe(true)
		expect(counter.take("c0")).toBe(true)
		expect(counter.take("c0")).toBe(false)
		expect(counter.take("new")).toBe(true)
		expect(counter.take("new")).toBe(false)
	})

	it("evicts expired keys and keeps refreshed windows in age order", () => {
		const counter = createRateCounter(1)
		expect(counter.take("old")).toBe(true)
		vi.advanceTimersByTime(30_000)
		for (let index = 0; index < 9_999; index += 1) {
			expect(counter.take(`c${index}`)).toBe(true)
		}
		vi.advanceTimersByTime(30_001)
		expect(counter.take("old")).toBe(true)
		expect(counter.take("new")).toBe(true)
		vi.advanceTimersByTime(30_000)
		expect(counter.take("new")).toBe(false)
		expect(counter.take("old")).toBe(false)
		vi.advanceTimersByTime(30_001)
		expect(counter.take("new")).toBe(true)
		expect(counter.take("old")).toBe(true)
	})
})
