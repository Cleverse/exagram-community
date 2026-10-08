import { describe, expect, it } from "vitest"

import { generalAccessDetails, generalAccessOptionsFor, needsAllowedDomain } from "./generalAccess"

import { edition as community } from "@/edition/edition"
import { asCommunityGeneralAccess } from "@/test/edition"

const values = (kind: "team" | "personal", offerOrg: boolean) =>
	generalAccessOptionsFor(kind, offerOrg).map((option) => option.value)

describe("General Access choices", () => {
	it("offers Restricted and Anyone with the link without the Workspace choice", () => {
		expect(values("team", false)).toEqual(["restricted", "anyone"])
		expect(values("personal", false)).toEqual(["restricted", "anyone"])
		expect(values("personal", true)).toEqual(["restricted", "anyone"])
	})

	it("never asks for an Allowed Domain while the Workspace choice is not offered", () => {
		expect(needsAllowedDomain("team", { orgDomain: null, generalAccess: "restricted" }, false)).toBe(false)
		expect(needsAllowedDomain("team", { orgDomain: null, generalAccess: "restricted" }, true)).toBe(true)
	})

	it("names who an open file reaches in File info", () => {
		const scope = { workspaceName: "Acme", orgDomain: "acme.com" }
		expect(generalAccessDetails({ ...scope, generalAccess: "restricted" })).toBeNull()
		expect(generalAccessDetails({ ...scope, generalAccess: "anyone" })).toBe("Anyone with the link")
	})

	it("describes a stored Workspace choice in Community without naming the Workspace", () => {
		asCommunityGeneralAccess()
		expect(community.generalAccessOrg).toBe(false)
		const stored = { workspaceName: "Acme", orgDomain: "acme.com", generalAccess: "org" as const }
		const copy = community.copy.generalAccessOrg
		for (const sentence of [
			copy.label(stored),
			copy.description({ ...stored, anyoneSettings: null }),
			copy.copied({ ...stored, anyoneSettings: null }),
			copy.chosen(stored),
			copy.details(stored),
			copy.needsDomain("Acme"),
			generalAccessDetails(stored),
		]) {
			expect(sentence).not.toMatch(/Acme|workspace|organi[sz]ation/i)
		}
		expect(generalAccessDetails(stored)).toBe("Anyone on the allowed domain with the link")
	})
})
