import { type Grant } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import {
	ceilingFor,
	groupLine,
	initialsOf,
	newPersonCopy,
	noInviteNote,
	rolesFor,
	shownRole,
	rolesUpTo,
	splitGrants,
	startingRole,
	whoLabel,
} from "./useShareModel"

import { groupGrant, personGrant } from "@/test/grants"

const grant = (over: Partial<Grant> = {}): Grant =>
	personGrant({
		id: "g1",
		artifactId: "a1",
		projectId: null,
		granteeId: "u2",
		granteeEmail: "new@example.com",
		granteeName: "new@example.com",
		granteePending: true,
		role: "collaborate",
		pinnedRevisionId: null,
		createdAt: new Date("2026-09-01T00:00:00Z"),
		...over,
	})

describe("share rules", () => {
	it("hands out roles up to the caller's own in a Team, and none to a Viewer", () => {
		expect(rolesUpTo(ceilingFor("owner"), "team")).toEqual(["view", "collaborate", "edit"])
		expect(rolesUpTo(ceilingFor("edit"), "team")).toEqual(["view", "collaborate", "edit"])
		expect(rolesUpTo(ceilingFor("collaborate"), "team")).toEqual(["view", "collaborate"])
		expect(rolesUpTo(ceilingFor("view"), "team")).toEqual([])
	})

	it("drops Collaborator in a Personal Workspace whatever the caller holds", () => {
		expect(rolesFor("personal")).toEqual(["view", "edit"])
		expect(rolesUpTo(ceilingFor("owner"), "personal")).toEqual(["view", "edit"])
		expect(rolesUpTo(ceilingFor("edit"), "personal")).toEqual(["view", "edit"])
		expect(rolesUpTo(ceilingFor("collaborate"), "personal")).toEqual(["view"])
		expect(rolesUpTo(ceilingFor("view"), "personal")).toEqual([])
	})

	it("starts at Viewer, the narrowest, until a Team's default share role is known, and always in a Personal Workspace", () => {
		expect(startingRole("team", undefined, rolesUpTo("edit", "team"))).toBe("view")
		expect(startingRole("personal", undefined, rolesUpTo("edit", "personal"))).toBe("view")
	})

	it("starts a Team share at the Workspace default, clamped to the strongest role the caller may hand out", () => {
		const owner = rolesUpTo(ceilingFor("owner"), "team")
		const collaborator = rolesUpTo(ceilingFor("collaborate"), "team")
		expect(startingRole("team", "edit", owner)).toBe("edit")
		expect(startingRole("team", "view", owner)).toBe("view")
		expect(startingRole("team", "edit", collaborator)).toBe("collaborate")
		expect(startingRole("team", "view", collaborator)).toBe("view")
	})

	it("ignores a Team default in a Personal Workspace", () => {
		expect(startingRole("personal", "edit", rolesUpTo("edit", "personal"))).toBe("view")
	})

	it("reads a Collaborator Grant as Editor in a Personal Workspace, and as itself in a Team", () => {
		expect(shownRole("personal", "collaborate")).toBe("edit")
		expect(shownRole("personal", "view")).toBe("view")
		expect(shownRole("personal", "edit")).toBe("edit")
		expect(shownRole("team", "collaborate")).toBe("collaborate")
	})

	it("says a new address is not in the Workspace in a Team, and only that it goes by email in a Personal Workspace", () => {
		expect(newPersonCopy("team", "Acme")).toEqual({
			badge: "New to Acme",
			heading: "Not in Acme yet",
			row: "Not in Acme yet — send them the link",
		})
		expect(newPersonCopy("personal", "Personal")).toEqual({
			badge: "By email",
			heading: "Share by email",
			row: "Send them the link after sharing",
		})
	})

	it("draws two initials, or ? for no name", () => {
		expect(initialsOf("grace brewster hopper")).toBe("GB")
		expect(initialsOf("  ")).toBe("?")
	})
})

describe("noInviteNote", () => {
	const member = { kind: "team", member: true } as const
	const guest = { kind: "team", member: false } as const

	it("tells a Team Viewer they can ask a Collaborator", () => {
		expect(noInviteNote("view", member)).toBe(
			"You can view and download this. Ask a Collaborator or the Owner to invite someone.",
		)
	})

	it("names the role a Guest actually holds, and sends them to the Owner", () => {
		expect(noInviteNote("edit", guest)).toBe("You can view, download and edit this. Ask the Owner to invite someone.")
		expect(noInviteNote("collaborate", guest)).toBe(
			"You can view, download and propose changes to this. Ask the Owner to invite someone.",
		)
		expect(noInviteNote("view", guest)).toBe("You can view and download this. Ask the Owner to invite someone.")
	})

	it("leaves out download for a Viewer whose link withholds it", () => {
		expect(noInviteNote("view", guest, false)).toBe("You can view this. Ask the Owner to invite someone.")
	})

	it("never mentions a Collaborator in a Personal Workspace", () => {
		expect(noInviteNote("view", { kind: "personal", member: true })).not.toMatch(/Collaborator/)
		expect(noInviteNote("edit", { kind: "personal", member: false })).not.toMatch(/Collaborator/)
	})

	it("says nothing about a role it does not know", () => {
		expect(noInviteNote(null, guest)).toBe("You can't add people here. Ask the Owner to invite someone.")
	})
})

describe("invited people", () => {
	it("splits the grant list into Groups, people who signed in, and people still invited", () => {
		const member = grant({ id: "g2", granteePending: false })
		const invited = grant()
		const group = groupGrant(
			{ id: "grp1", name: "Design team", memberCount: 3 },
			{
				id: "g3",
				artifactId: "a1",
				projectId: null,
				role: "collaborate",
				pinnedRevisionId: null,
				createdAt: new Date("2026-09-01T00:00:00Z"),
			},
		)
		expect(splitGrants([member, group, invited])).toEqual({ groups: [group], members: [member], invited: [invited] })
	})
})

describe("Group copy", () => {
	it("reads Group, the member count and, once known, the role", () => {
		expect(groupLine(3)).toBe("Group · 3 members")
		expect(groupLine(1)).toBe("Group · 1 member")
		expect(groupLine(3, "collaborate")).toBe("Group · 3 members · Collaborator")
	})

	it("counts people and Groups, leaving out whichever is none", () => {
		expect(whoLabel(2, 1)).toBe("2 people and 1 group")
		expect(whoLabel(1, 2)).toBe("1 person and 2 groups")
		expect(whoLabel(0, 1)).toBe("1 group")
		expect(whoLabel(3, 0)).toBe("3 people")
	})
})
