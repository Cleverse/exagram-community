import { describe, expect, it } from "vitest"

import { shortcutOf } from "./shortcuts"

const press = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
	key,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	...mods,
})

describe("shortcutOf", () => {
	it("opens search on ⌘P, ⌘K or their Ctrl spellings", () => {
		expect(shortcutOf(press("p", { metaKey: true }))).toBe("search")
		expect(shortcutOf(press("k", { metaKey: true }))).toBe("search")
		expect(shortcutOf(press("K", { ctrlKey: true }))).toBe("search")
		expect(shortcutOf(press("p", { ctrlKey: true }))).toBe("search")
	})

	it("copies the link on ⌘L or Ctrl+L", () => {
		expect(shortcutOf(press("l", { metaKey: true }))).toBe("copyLink")
		expect(shortcutOf(press("l", { ctrlKey: true }))).toBe("copyLink")
	})

	it("leaves plain keys and other chords to the page and the browser", () => {
		expect(shortcutOf(press("k"))).toBeNull()
		expect(shortcutOf(press("p", { metaKey: true, shiftKey: true }))).toBeNull()
		expect(shortcutOf(press("l", { metaKey: true, altKey: true }))).toBeNull()
		expect(shortcutOf(press("s", { metaKey: true }))).toBeNull()
	})
})
