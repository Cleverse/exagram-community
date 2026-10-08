import { describe, expect, it } from "vitest"

import { SHEETS } from "./registry"
import { SHEET_KINDS } from "./types"

describe("drawer registry", () => {
	// A kind with no module opens "Not available here yet"; every kind a screen can open must have its drawer.
	it("has a drawer module for every kind", () => {
		expect(SHEET_KINDS.filter((kind) => !SHEETS.has(kind))).toEqual([])
	})
})
