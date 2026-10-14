import { afterEach, describe, expect, it } from "vitest"

import { clearRecentViews, recordView, viewOf } from "./recentlyViewed"

const TEAM = "00000000-0000-4000-8000-0000000000a1"
const PERSONAL = "00000000-0000-4000-8000-0000000000a2"

const stored = (scope: string) =>
	JSON.parse(window.localStorage.getItem(`exagram.recentlyViewed.${scope}`) ?? "[]") as unknown

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
		recordView(TEAM, "file", "a1", 1)
		recordView(TEAM, "project", "p1", 2)
		recordView(TEAM, "file", "a1", 3)
		expect(stored(TEAM)).toEqual([
			{ kind: "file", id: "a1", at: 3 },
			{ kind: "project", id: "p1", at: 2 },
		])
	})

	it("keeps each Workspace's views apart, so one never lists the other's files", () => {
		recordView(TEAM, "file", "team-file", 1)
		recordView(PERSONAL, "file", "personal-file", 2)
		expect(stored(TEAM)).toEqual([{ kind: "file", id: "team-file", at: 1 }])
		expect(stored(PERSONAL)).toEqual([{ kind: "file", id: "personal-file", at: 2 }])
	})
})
