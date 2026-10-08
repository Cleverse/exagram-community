import { describe, expect, it } from "vitest"

import { CreateProjectBodySchema, MoveProjectBodySchema } from "./types"

describe("projects contract schemas", () => {
	it("defaults a created project to the root", () => {
		expect(CreateProjectBodySchema.parse({ name: "P" })).toEqual({ name: "P", parentProjectId: null })
	})

	it("accepts an explicit null parent on move and refuses an empty name", () => {
		expect(MoveProjectBodySchema.parse({ parentProjectId: null })).toEqual({ parentProjectId: null })
		expect(() => CreateProjectBodySchema.parse({ name: "" })).toThrow()
	})
})
