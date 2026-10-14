import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useNow } from "./useNow"

afterEach(() => {
	vi.useRealTimers()
})

describe("useNow", () => {
	it("moves on every minute and when the window regains focus, so Today rolls over at midnight", () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date(2026, 8, 13, 23, 59, 30))
		const { result } = renderHook(() => useNow())
		expect(result.current.getDate()).toBe(13)

		act(() => {
			vi.advanceTimersByTime(60_000)
		})
		expect(result.current.getDate()).toBe(14)

		vi.setSystemTime(new Date(2026, 8, 15, 9, 0))
		act(() => {
			window.dispatchEvent(new Event("focus"))
		})
		expect(result.current.getDate()).toBe(15)
	})
})
