import { describe, expect, it } from "vitest"

import { paneFrame } from "./paneLayout"

describe("paneFrame", () => {
	it("fills everything right of the list with no width cap, and never shrinks under 360px", () => {
		const frame = paneFrame(false)
		expect(frame).toMatchObject({ flex: "1 1 0", minWidth: 360 })
		expect(frame.maxWidth).toBeUndefined()
		expect(frame.width).toBeUndefined()
	})

	it("raises its minimum by the open side panel, Comments or the Ledger 320; the History modal adds nothing", () => {
		expect(paneFrame(false, "history")).toMatchObject({ minWidth: 360 })
		expect(paneFrame(false, "comments")).toMatchObject({ minWidth: 680 })
		expect(paneFrame(false, "ledger")).toMatchObject({ minWidth: 680 })
		expect(paneFrame(false, null)).toMatchObject({ minWidth: 360 })
	})

	it("covers the viewport in full view", () => {
		expect(paneFrame(true)).toMatchObject({ position: "fixed", inset: 0, width: "100vw", height: "100vh" })
	})
})
