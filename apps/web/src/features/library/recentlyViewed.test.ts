import { afterEach, describe, expect, it } from "vitest"

import { clearRecentViews, recordView, viewOf } from "./recentlyViewed"

describe("viewOf", () => {
	it("names the file on its page or in a preview, else the Project page", () => {
		expect(viewOf("/artifacts/a1", "")).toEqual({ kind: "file", id: "a1" })
		expect(viewOf("/projects/p1", "?preview=a2")).toEqual({ kind: "file", id: "a2" })
		expect(viewOf("/projects/p1", "")).toEqual({ kind: "project", id: "p1" })
		expect(viewOf("/activity", "")).toBeNull()
	})
})

describe("recordView", () => {
	afterEach(() => clearRecentViews())

	it("keeps each view once, newest first, and stores it", () => {
		recordView("file", "a1", 1)
		recordView("project", "p1", 2)
		recordView("file", "a1", 3)
		const stored = JSON.parse(window.localStorage.getItem("exagram.recentlyViewed") ?? "[]") as unknown
		expect(stored).toEqual([
			{ kind: "file", id: "a1", at: 3 },
			{ kind: "project", id: "p1", at: 2 },
		])
	})
})
