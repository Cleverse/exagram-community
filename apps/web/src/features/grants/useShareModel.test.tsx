import { type Grant } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import {
	ceilingFor,
	initialRoleFor,
	initialsOf,
	newPersonCopy,
	noInviteNote,
	rolesFor,
	shownRole,
	rolesUpTo,
	splitGrants,
} from "./useShareModel"

const grant = (over: Partial<Grant> = {}): Grant => ({
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

	it("starts at Collaborator in a Team and at Viewer in a Personal Workspace", () => {
		expect(initialRoleFor("team")).toBe("collaborate")
		expect(initialRoleFor("personal")).toBe("view")
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
	it("splits the grant list into people who signed in and people still invited", () => {
		const member = grant({ id: "g2", granteePending: false })
		const invited = grant()
		expect(splitGrants([member, invited])).toEqual({ members: [member], invited: [invited] })
	})
})
