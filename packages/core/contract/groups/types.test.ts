import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { GroupBodySchema } from "./types"

describe("GroupBodySchema", () => {
	const member = randomUUID()

	it("trims the name", () => {
		expect(GroupBodySchema.parse({ name: "  Design  ", memberIds: [member] })).toEqual({
			name: "Design",
			memberIds: [member],
		})
	})

	it("refuses a blank name, a name over 100 characters, no members, or a member that is no id", () => {
		expect(GroupBodySchema.safeParse({ name: "   ", memberIds: [member] }).success).toBe(false)
		expect(GroupBodySchema.safeParse({ name: "x".repeat(101), memberIds: [member] }).success).toBe(false)
		expect(GroupBodySchema.safeParse({ name: "Design", memberIds: [] }).success).toBe(false)
		expect(GroupBodySchema.safeParse({ name: "Design", memberIds: ["bo"] }).success).toBe(false)
	})

	it("takes 1000 members and no more", () => {
		const ids = (count: number) => Array.from({ length: count }, () => randomUUID())
		expect(GroupBodySchema.safeParse({ name: "Design", memberIds: ids(1000) }).success).toBe(true)
		expect(GroupBodySchema.safeParse({ name: "Design", memberIds: ids(1001) }).success).toBe(false)
	})
})
