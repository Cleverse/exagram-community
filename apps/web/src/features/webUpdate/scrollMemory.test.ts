import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	captureScroll,
	elementAtPath,
	elementPath,
	restoreScrollAfterReload,
	saveScrollForReload,
	SCROLL_MEMORY_KEY,
	SCROLL_RESTORE_TIMEOUT_MS,
} from "./scrollMemory"

/** jsdom has no layout: give an element a settable offset clamped to a fake content height. */
const scrollable = (element: HTMLElement, max: () => number) => {
	let top = 0
	Object.defineProperty(element, "scrollTop", {
		configurable: true,
		get: () => top,
		set: (value: number) => {
			top = Math.max(0, Math.min(value, max()))
		},
	})
	return element
}

const main = () => {
	const element = document.querySelector("main")
	if (!element) throw new Error("missing main")
	return element
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("scrollMemory", () => {
	beforeEach(() => {
		sessionStorage.clear()
		document.body.innerHTML = `<div><main></main></div>`
	})
	afterEach(() => {
		vi.useRealTimers()
		document.body.innerHTML = ""
	})

	it("finds an element again by its path", () => {
		expect(elementPath(main())).toBe("0/0")
		expect(elementAtPath("0/0")).toBe(main())
		expect(elementAtPath("0/5")).toBeNull()
	})

	it("captures only the elements that are scrolled", () => {
		const element = scrollable(main(), () => 1000)
		expect(captureScroll()).toEqual([])
		element.scrollTop = 300
		expect(captureScroll()).toEqual([{ path: "0/0", top: 300, left: 0 }])
	})

	it("puts the offset back once the content is tall enough, then forgets it", async () => {
		scrollable(main(), () => 1000).scrollTop = 420
		saveScrollForReload()

		// The reloaded page starts empty: nothing can scroll until its data arrives.
		let height = 0
		document.body.innerHTML = `<div><main></main></div>`
		const fresh = scrollable(main(), () => height)
		restoreScrollAfterReload()
		expect(fresh.scrollTop).toBe(0)

		height = 1000
		fresh.append(document.createElement("p"))
		await flush()
		expect(fresh.scrollTop).toBe(420)
		expect(sessionStorage.getItem(SCROLL_MEMORY_KEY)).toBeNull()
	})

	it("ignores a snapshot from another URL", () => {
		sessionStorage.setItem(
			SCROLL_MEMORY_KEY,
			JSON.stringify({ href: "http://elsewhere/", at: Date.now(), entries: [{ path: "0/0", top: 5, left: 0 }] }),
		)
		const element = scrollable(main(), () => 1000)
		restoreScrollAfterReload()
		expect(element.scrollTop).toBe(0)
	})

	it("gives up when the reader scrolls first", async () => {
		vi.useFakeTimers()
		scrollable(main(), () => 1000).scrollTop = 420
		saveScrollForReload()

		let height = 0
		document.body.innerHTML = `<div><main></main></div>`
		const fresh = scrollable(main(), () => height)
		restoreScrollAfterReload()
		window.dispatchEvent(new Event("wheel"))
		height = 1000
		fresh.append(document.createElement("p"))
		await vi.advanceTimersByTimeAsync(SCROLL_RESTORE_TIMEOUT_MS)
		expect(fresh.scrollTop).toBe(0)
	})
})
