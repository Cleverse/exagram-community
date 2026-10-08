import { describe, expect, it } from "vitest"

import { checkUpload, kindForFile, MAX_BODY_BYTES, UPLOAD_ACCEPT } from "./upload"

describe("kindForFile", () => {
	it("reads the kind from the extension", () => {
		expect(kindForFile("notes.md")).toEqual({ kind: "doc", mime: "text/markdown" })
		expect(kindForFile("page.html")).toEqual({ kind: "html", mime: "text/html" })
		expect(kindForFile("thread.json")).toEqual({ kind: "chat", mime: "application/json" })
		expect(kindForFile("rows.csv")).toEqual({ kind: "doc", mime: "text/csv" })
		expect(kindForFile("deck.pptx")?.kind).toBe("pptx")
	})

	it("refuses an extension Exagram does not store", () => {
		expect(kindForFile("photo.exe")).toBeNull()
	})

	it("accepts exactly the supported raster image extensions and rejects SVG", () => {
		expect(
			["photo.png", "photo.jpg", "photo.jpeg", "photo.webp", "photo.gif", "photo.heic", "photo.heif"].map((filename) =>
				kindForFile(filename),
			),
		).toEqual([
			{ kind: "image", mime: "image/png" },
			{ kind: "image", mime: "image/jpeg" },
			{ kind: "image", mime: "image/jpeg" },
			{ kind: "image", mime: "image/webp" },
			{ kind: "image", mime: "image/gif" },
			{ kind: "image", mime: "image/heic" },
			{ kind: "image", mime: "image/heif" },
		])
		expect(kindForFile("photo.svg")).toBeNull()
		expect(UPLOAD_ACCEPT).toContain(".heic,.heif")
		expect(UPLOAD_ACCEPT).not.toContain(".svg")
	})
})

describe("checkUpload", () => {
	it("accepts a file inside the limit", () => {
		expect(checkUpload({ name: "notes.md", size: 10 })).toBeNull()
	})

	it("refuses an empty file", () => {
		expect(checkUpload({ name: "notes.md", size: 0 })).toBe(
			"This file is empty — Exagram cannot store an empty Revision",
		)
	})

	it("refuses a file over the limit", () => {
		expect(checkUpload({ name: "notes.md", size: MAX_BODY_BYTES + 1 })).toContain("over the 20 MB limit")
	})
})
