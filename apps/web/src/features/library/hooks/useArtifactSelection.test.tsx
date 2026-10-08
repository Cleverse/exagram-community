import { act, fireEvent, renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { MemoryRouter, useLocation } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useArtifactSelection } from "./useArtifactSelection"
import { artifact, originalWidth, setWindowWidth, useSubject, wrapper } from "./useArtifactSelection.harness"

import { PREVIEW_MIN_VIEWPORT } from "@/routes/paths"

describe("useArtifactSelection", () => {
	beforeEach(() => setWindowWidth(PREVIEW_MIN_VIEWPORT + 160))
	afterEach(() => setWindowWidth(originalWidth))

	it("reads the preview from ?preview on the list's own path", () => {
		const { result } = renderHook(useSubject, { wrapper: wrapper("/projects/p1?preview=a2") })
		expect(result.current.selection.selected?.id).toBe("a2")
	})

	it("previews beside the list on a wide window, and clears back to the plain list", () => {
		const { result } = renderHook(useSubject, { wrapper: wrapper("/mine") })
		act(() => result.current.selection.select("a1"))
		expect(result.current.path).toBe("/mine?preview=a1")
		act(() => result.current.selection.clear())
		expect(result.current.path).toBe("/mine")
	})

	it("opens the full page instead on a window too narrow for the list and the preview side by side", () => {
		setWindowWidth(PREVIEW_MIN_VIEWPORT - 1)
		const { result } = renderHook(useSubject, { wrapper: wrapper("/projects/p1") })
		act(() => result.current.selection.select("a1"))
		expect(result.current.path).toBe("/artifacts/a1")
		expect(result.current.returnTo).toBe("/projects/p1?preview=a1")
	})

	it("opens the full page with Open, a double click or Enter, telling it the list to return to", () => {
		const { result } = renderHook(useSubject, { wrapper: wrapper("/projects/p1?preview=a2&panel=history") })
		act(() => result.current.selection.open("a2"))
		expect(result.current.path).toBe("/artifacts/a2")
		expect(result.current.returnTo).toBe("/projects/p1?preview=a2&panel=history")
		expect(result.current.navigationType).toBe("PUSH")
	})

	it("ignores a preview id the list does not hold", () => {
		const { result } = renderHook(useSubject, { wrapper: wrapper("/?preview=zzz") })
		expect(result.current.selection.selected).toBeNull()
		expect(result.current.selection.selectedId).toBeNull()
		expect(result.current.selection.missingPreviewId).toBe("zzz")
	})

	it("keeps the requested id and flags a landing until the list selects", () => {
		const { result } = renderHook(useSubject, { wrapper: wrapper("/?preview=zzz") })
		expect(result.current.selection.requestedId).toBe("zzz")
		expect(result.current.selection.landed).toBe(true)
		act(() => result.current.selection.select("a1"))
		expect(result.current.selection.landed).toBe(false)
	})

	it("flags a reload as a landing even though the browser kept the list's marker", async () => {
		// Select a row, then read back the history state the browser would keep across a reload.
		const opened = renderHook(() => ({ selection: useArtifactSelection([artifact("a1")]), location: useLocation() }), {
			wrapper: wrapper("/"),
		})
		act(() => opened.result.current.selection.select("a1"))
		const kept = opened.result.current.location.state as unknown
		expect(opened.result.current.selection.landed).toBe(false)

		// A reload evaluates the module afresh; feed the new copy that same kept state.
		vi.resetModules()
		const fresh = await import("./useArtifactSelection")
		const reloaded = ({ children }: { children: ReactNode }) => (
			<MemoryRouter initialEntries={[{ pathname: "/", search: "?preview=a1", state: kept }]}>{children}</MemoryRouter>
		)
		const { result } = renderHook(() => fresh.useArtifactSelection([artifact("a1")]), { wrapper: reloaded })
		expect(result.current.landed).toBe(true)
	})

	it("pushes history only when going from no preview to a preview", () => {
		const { result } = renderHook(useSubject, { wrapper: wrapper("/mine") })
		const types: string[] = []
		act(() => result.current.selection.select("a1")) // no preview -> preview: push
		types.push(result.current.navigationType)
		act(() => result.current.selection.select("a2")) // preview -> another preview: replace
		types.push(result.current.navigationType)
		expect(types).toEqual(["PUSH", "REPLACE"])
	})

	it("Escape closes the preview, unless a menu or dialog already took it", () => {
		const { result } = renderHook(useSubject, { wrapper: wrapper("/?preview=a1") })
		act(() => {
			const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
			event.preventDefault()
			window.dispatchEvent(event)
		})
		expect(result.current.path).toBe("/?preview=a1")
		act(() => void fireEvent.keyDown(window, { key: "Escape" }))
		expect(result.current.path).toBe("/")
	})

	it("clear replaces rather than going Back, so it never steps through history the previewed page pushed", () => {
		const { result } = renderHook(useSubject, { wrapper: wrapper("/mine") })
		act(() => result.current.selection.select("a1"))
		act(() => result.current.selection.clear())
		expect(result.current.path).toBe("/mine")
		expect(result.current.navigationType).toBe("REPLACE")
	})

	it("clear replaces a deep link too", () => {
		const { result } = renderHook(useSubject, { wrapper: wrapper("/?preview=a1") })
		act(() => result.current.selection.clear())
		expect(result.current.path).toBe("/")
		expect(result.current.navigationType).toBe("REPLACE")
	})
})
