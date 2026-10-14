import { describe, expect, it } from "vitest"

import { DIFF_CELL_LIMIT, lineDiff, linesOf } from "./lineDiff"

describe("lineDiff", () => {
	it("keeps identical text as unchanged lines", () => {
		expect(lineDiff("a\nb", "a\nb")).toEqual([
			{ kind: "same", text: "a" },
			{ kind: "same", text: "b" },
		])
	})

	it("marks a replaced line as a removal followed by its addition", () => {
		expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual([
			{ kind: "same", text: "a" },
			{ kind: "removed", text: "b" },
			{ kind: "added", text: "B" },
			{ kind: "same", text: "c" },
		])
	})

	it("finds insertions and deletions around unchanged lines", () => {
		expect(lineDiff("one\ntwo\nthree", "zero\none\nthree\nfour")).toEqual([
			{ kind: "added", text: "zero" },
			{ kind: "same", text: "one" },
			{ kind: "removed", text: "two" },
			{ kind: "same", text: "three" },
			{ kind: "added", text: "four" },
		])
	})

	it("diffs from nothing and to nothing", () => {
		expect(lineDiff("", "x")).toEqual([{ kind: "added", text: "x" }])
		expect(lineDiff("x", "")).toEqual([{ kind: "removed", text: "x" }])
		expect(lineDiff("", "")).toEqual([])
		expect(lineDiff("x\ny", "x")).toEqual([
			{ kind: "same", text: "x" },
			{ kind: "removed", text: "y" },
		])
	})

	it("treats CRLF and LF line ends as the same lines", () => {
		expect(lineDiff("one\r\ntwo\r\n", "one\ntwo\n")).toEqual([
			{ kind: "same", text: "one" },
			{ kind: "same", text: "two" },
		])
	})

	it("does not count a trailing newline as a line of its own", () => {
		expect(lineDiff("a", "a\n")).toEqual([{ kind: "same", text: "a" }])
		expect(linesOf("a\n\n")).toEqual(["a", ""])
	})

	it("gives up on inputs too large to compare in the browser", () => {
		const side = Math.ceil(Math.sqrt(DIFF_CELL_LIMIT)) + 1
		const before = Array.from({ length: side }, (_, index) => `a${index}`).join("\n")
		const after = Array.from({ length: side }, (_, index) => `b${index}`).join("\n")
		expect(lineDiff(before, after)).toBeNull()
	})
})
