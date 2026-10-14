import { act, renderHook } from "@testing-library/react"
import { createElement, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LIST_DEFAULT_WIDTH, LIST_MIN_WIDTH, PANE_MIN_WIDTH, SIDE_PANEL_MIN_WIDTH, useListWidth } from "./useListWidth"

import { RAIL_WIDTH, SIDEBAR_WIDTH, SidebarWidthContext } from "@/components/sidebar/sidebarWidth"

const STORAGE_KEY = "exagram.listWidth"

const setInnerWidth = (value: number) => {
	Object.defineProperty(window, "innerWidth", { configurable: true, value })
}

/** The hook reads `?panel=` from the URL, so it renders inside a router; the sidebar width is optional. */
const at = (entry = "/", sidebarWidth?: number) => ({
	wrapper: ({ children }: { children: ReactNode }) => {
		const routed = createElement(MemoryRouter, { initialEntries: [entry] }, children)
		return sidebarWidth === undefined
			? routed
			: createElement(SidebarWidthContext.Provider, { value: sidebarWidth }, routed)
	},
})

const withSidebar = (width: number) => at("/", width)

describe("useListWidth", () => {
	beforeEach(() => {
		window.localStorage.clear()
		setInnerWidth(1600)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("opens the list at 400px when there is room", () => {
		const { result } = renderHook(() => useListWidth(), at())
		expect(result.current.width).toBe(LIST_DEFAULT_WIDTH)
	})

	it("starts from a stored width", () => {
		window.localStorage.setItem(STORAGE_KEY, "520")
		expect(renderHook(() => useListWidth(), at()).result.current.width).toBe(520)
	})

	it("falls back to the default when storage throws", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("denied")
		})
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("denied")
		})
		const { result } = renderHook(() => useListWidth(), at())
		expect(result.current.width).toBe(LIST_DEFAULT_WIDTH)
		act(() => result.current.nudge(24))
		expect(result.current.width).toBe(LIST_DEFAULT_WIDTH + 24)
	})

	it("leaves the pane its 360px beside the sidebar, and never goes under 300px", () => {
		setInnerWidth(SIDEBAR_WIDTH + PANE_MIN_WIDTH + 350)
		expect(renderHook(() => useListWidth(), at()).result.current.width).toBe(350)

		setInnerWidth(SIDEBAR_WIDTH + PANE_MIN_WIDTH + 100)
		expect(renderHook(() => useListWidth(), at()).result.current.width).toBe(LIST_MIN_WIDTH)
	})

	it("measures from the 56px rail when the sidebar is collapsed", () => {
		setInnerWidth(SIDEBAR_WIDTH + PANE_MIN_WIDTH + 350)
		const { result } = renderHook(() => useListWidth(), withSidebar(RAIL_WIDTH))
		expect(result.current.width).toBe(LIST_DEFAULT_WIDTH)
		expect(result.current.max).toBe(350 + SIDEBAR_WIDTH - RAIL_WIDTH)
	})

	it("squeezes the shown width on a narrow window without forgetting or rewriting the preference", () => {
		window.localStorage.setItem(STORAGE_KEY, "600")
		const { result } = renderHook(() => useListWidth(), at())

		act(() => {
			setInnerWidth(SIDEBAR_WIDTH + PANE_MIN_WIDTH + 350)
			window.dispatchEvent(new Event("resize"))
		})
		expect(result.current.width).toBe(350)
		expect(result.current.max).toBe(350)
		expect(result.current.preferred).toBe(600)
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe("600")

		act(() => {
			setInnerWidth(1600)
			window.dispatchEvent(new Event("resize"))
		})
		expect(result.current.width).toBe(600)
	})

	it("remembers a keyboard nudge", () => {
		const { result } = renderHook(() => useListWidth(), at())
		act(() => result.current.nudge(-24))
		expect(result.current.width).toBe(LIST_DEFAULT_WIDTH - 24)
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(LIST_DEFAULT_WIDTH - 24))
	})

	it("writes a drag to storage only when it ends, not on every move", () => {
		const { result } = renderHook(() => useListWidth(), at())
		const handle = document.createElement("div")
		handle.setPointerCapture = vi.fn()
		act(() =>
			result.current.startDrag({
				button: 0,
				pointerId: 1,
				preventDefault: vi.fn(),
				currentTarget: handle,
			} as unknown as ReactPointerEvent<HTMLElement>),
		)

		act(() => {
			handle.dispatchEvent(new MouseEvent("pointermove", { clientX: SIDEBAR_WIDTH + 500 }))
		})
		expect(result.current.width).toBe(500)
		expect(result.current.dragging).toBe(true)
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()

		act(() => {
			handle.dispatchEvent(new MouseEvent("pointerup"))
		})
		expect(result.current.dragging).toBe(false)
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe("500")
	})

	it("stops a drag where the pane would go under 360px, and where the list would go under 300px", () => {
		setInnerWidth(SIDEBAR_WIDTH + 1000)
		const { result } = renderHook(() => useListWidth(), at())
		const handle = document.createElement("div")
		handle.setPointerCapture = vi.fn()
		act(() =>
			result.current.startDrag({
				button: 0,
				pointerId: 1,
				preventDefault: vi.fn(),
				currentTarget: handle,
			} as unknown as ReactPointerEvent<HTMLElement>),
		)

		act(() => {
			handle.dispatchEvent(new MouseEvent("pointermove", { clientX: SIDEBAR_WIDTH + 990 }))
		})
		expect(result.current.width).toBe(1000 - PANE_MIN_WIDTH)

		act(() => {
			handle.dispatchEvent(new MouseEvent("pointermove", { clientX: SIDEBAR_WIDTH + 40 }))
		})
		expect(result.current.width).toBe(LIST_MIN_WIDTH)
		act(() => {
			handle.dispatchEvent(new MouseEvent("pointerup"))
		})
	})

	it("gives way to an open side panel, so the pane keeps 360px of document beside it", () => {
		setInnerWidth(SIDEBAR_WIDTH + PANE_MIN_WIDTH + SIDE_PANEL_MIN_WIDTH + 350)
		expect(renderHook(() => useListWidth(), at("/artifacts/a1")).result.current.width).toBe(LIST_DEFAULT_WIDTH)
		for (const panel of ["comments", "ledger"]) {
			const side = renderHook(() => useListWidth(), at(`/artifacts/a1?panel=${panel}`)).result.current
			expect(side.width).toBe(350)
			expect(side.max).toBe(350)
		}
		// History is a modal now, so it leaves the list alone.
		expect(renderHook(() => useListWidth(), at("/artifacts/a1?panel=history")).result.current.width).toBe(
			LIST_DEFAULT_WIDTH,
		)

		// No room for both minimums: the list still keeps its own 300px.
		setInnerWidth(SIDEBAR_WIDTH + PANE_MIN_WIDTH + SIDE_PANEL_MIN_WIDTH + 100)
		expect(renderHook(() => useListWidth(), at("/artifacts/a1?panel=comments")).result.current.width).toBe(
			LIST_MIN_WIDTH,
		)
	})
})
