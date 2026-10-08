import { describe, expect, it } from "vitest"

import { menuPosition } from "./menuPosition"

const viewport = { width: 1440, height: 900 }
const at = (top: number, left = 100) => ({ top, bottom: top + 32, left })

describe("menuPosition", () => {
	it("opens 6px below the trigger and caps the card at 60% of the window", () => {
		expect(menuPosition(at(100), "down", 240, viewport)).toEqual({ left: 100, top: 138, maxHeight: 540 })
	})

	it("flips up when a trigger near the foot has little room below", () => {
		const position = menuPosition(at(820), "down", 240, viewport)
		expect(position).toMatchObject({ bottom: 900 - 820 + 6 })
		expect(position).not.toHaveProperty("top")
		expect(position.maxHeight).toBe(540)
	})

	it("keeps the account menu above its trigger, and flips down only when the top is tighter", () => {
		expect(menuPosition(at(840), "up", 240, viewport)).toMatchObject({ bottom: 66 })
		expect(menuPosition(at(40), "up", 240, viewport)).toMatchObject({ top: 78 })
	})

	it("caps the card to the room it has so it never runs off the window", () => {
		const position = menuPosition(at(500), "down", 240, viewport)
		expect(position).toMatchObject({ top: 538, maxHeight: 900 - 532 - 6 - 8 })
	})

	it("holds the card 8px inside the left and right edges", () => {
		expect(menuPosition(at(100, 1400), "down", 240, viewport).left).toBe(1440 - 240 - 8)
		expect(menuPosition(at(100, -20), "down", 240, viewport).left).toBe(8)
		expect(menuPosition(at(100, 0), "down", 240, { width: 200, height: 900 }).left).toBe(8)
	})
})
