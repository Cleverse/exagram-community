import { describe, expect, it } from "vitest"

import { readingRevisionOf } from "./useReadingRevision"

const queue = [
	{ artifactId: "a-other", revisionId: "r-other" },
	{ artifactId: "a1", revisionId: "r-pending" },
]

describe("readingRevisionOf", () => {
	it("reads the Revision the boundary serves when there is one, even with a Pending one queued", () => {
		expect(readingRevisionOf({ id: "a1", visibleRevisionId: "r-current" }, queue)).toEqual({
			revisionId: "r-current",
			pending: false,
		})
	})

	it("reads the queued Pending Revision by id when nothing is approved yet", () => {
		expect(readingRevisionOf({ id: "a1", visibleRevisionId: null }, queue)).toEqual({
			revisionId: "r-pending",
			pending: true,
		})
	})

	it("has nothing to read when nothing is approved and this reader has no Pending Revision queued", () => {
		expect(readingRevisionOf({ id: "a2", visibleRevisionId: null }, queue)).toEqual({
			revisionId: null,
			pending: false,
		})
		expect(readingRevisionOf({ id: "a1", visibleRevisionId: null }, undefined)).toEqual({
			revisionId: null,
			pending: false,
		})
	})
})
