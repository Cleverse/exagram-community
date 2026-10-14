import { describe, expect, it } from "vitest"

import { switcherEntries } from "./switcherEntries"

const PERSONAL = { id: "p", kind: "personal", name: "Ada", role: "admin" } as const
const TEAM = { id: "t", kind: "team", name: "Acme", role: "member" } as const

describe("switcherEntries", () => {
	it("lists the person's Workspaces in the order me gives them, the session's marked current", () => {
		expect(switcherEntries({ workspaceId: "t", workspaces: [PERSONAL, TEAM] }, false)).toEqual([
			{ kind: "workspace", id: "p", label: "Personal", detail: undefined, current: false },
			{ kind: "workspace", id: "t", label: "Acme", detail: "Team", current: true },
		])
	})

	it("adds Create team last for a person with no Team, when it is on offer", () => {
		const me = { workspaceId: "p", workspaces: [PERSONAL] }
		expect(switcherEntries(me, true).at(-1)).toEqual({ kind: "createTeam" })
		expect(switcherEntries(me, false).map((entry) => entry.kind)).toEqual(["workspace"])
	})

	it("never offers Create team to a person who already has a Team, since there is no second Team in v1", () => {
		const me = { workspaceId: "p", workspaces: [PERSONAL, TEAM] }
		expect(switcherEntries(me, true).map((entry) => entry.kind)).toEqual(["workspace", "workspace"])
	})
})
