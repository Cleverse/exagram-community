import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { projectCopyIn } from "./projectCopy"

const SRC = path.resolve(import.meta.dirname, "..")

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) return sourceFiles(full)
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
	})

describe("project copy", () => {
	it("flags a sentence, a label and a template that name a project", () => {
		const source = [
			'export const a = "Move to project"',
			'export const b = <button aria-label="New project">Projects</button>',
			"export const c = `No ${count} projects yet`",
			"export const d = <p>Applies to this project and its sub-projects.</p>",
		].join("\n")
		expect(projectCopyIn("copy.tsx", source)).toHaveLength(5)
	})

	it("leaves identifiers, routes and keys alone", () => {
		const source = [
			'export const kind = "project"',
			'export const route = "/projects/:projectId"',
			'export const key = ["projects", "listForProject"]',
			'export const id = "project-name"',
			'import { x } from "project/ProjectsPage"',
		].join("\n")
		expect(projectCopyIn("keys.tsx", source)).toEqual([])
	})

	it.each([
		["a template tail that is one lowercase word", "`${n} projects`"],
		["a singular template tail", "`${n} project`"],
		["a template head set off by a space", "`projects ${n}`"],
		["a template middle between two values", "`${a} project ${b}`"],
		["a template tail with trailing punctuation", "`${n} sub-projects.`"],
		["JSX text after an element", "<p><b>{n}</b> projects</p>"],
		["JSX text that is one lowercase word", "<b>projects</b>"],
		["JSX text that is one capitalised word", "<span>{n} Projects</span>"],
		["JSX text with a possessive", "<p><b>{name}</b> project's</p>"],
	])("flags %s", (_name, source) => {
		expect(projectCopyIn("copy.tsx", `export const x = ${source}`)).toHaveLength(1)
	})

	it.each([
		["a route template", "`/projects/${id}`"],
		["a word glued to a value", "`projects${x}`"],
		["a class name after a value", "`${x} project-row`"],
		["a class name between values", "`${a}-project-row-${b}`"],
		["a quoted enum value", '"project"'],
		["a quoted key", '"projects"'],
	])("leaves %s alone", (_name, source) => {
		expect(projectCopyIn("keys.tsx", `export const x = ${source}`)).toEqual([])
	})

	it("exempts a design sample title only as the whole literal", () => {
		const exact = '"Internal AI Product Hackathon - Project Brief.md"'
		const embedded = ['"New Side Project folder"', '"Internal AI Product Hackathon - Project Brief.md (copy)"']
		expect(projectCopyIn("sample.ts", `export const title = ${exact}`)).toEqual([])
		for (const source of embedded) {
			expect(projectCopyIn("copy.ts", `export const title = ${source}`)).toHaveLength(1)
		}
	})

	it("finds none in the app's own screens", { timeout: 30_000 }, () => {
		const offenders = sourceFiles(SRC).flatMap((file) =>
			projectCopyIn(path.relative(SRC, file), readFileSync(file, "utf8")),
		)
		expect(offenders).toEqual([])
	})
})
