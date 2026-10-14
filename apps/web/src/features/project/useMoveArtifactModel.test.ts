import { describe, expect, it } from "vitest"

import { orderedProjects } from "./useMoveArtifactModel"

import { projectFixture } from "@/features/artifact/sheets/sheetHarness"

describe("orderedProjects", () => {
	it("puts each top-level Project before its own sub-projects, as the sidebar reads", () => {
		const rows = orderedProjects([
			projectFixture({ id: "child", name: "Pricing", parentProjectId: "sales" }),
			projectFixture({ id: "q4", name: "Q4" }),
			projectFixture({ id: "sales", name: "Sales" }),
		])
		expect(rows.map(({ project, nested }) => [project.name, nested])).toEqual([
			["Q4", false],
			["Sales", false],
			["Pricing", true],
		])
	})
})
