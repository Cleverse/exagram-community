import { type Revision, type VisibleArtifact } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { authorOf } from "./revision"

const artifact = { ownerId: "owner-1", ownerName: "Ada" } as VisibleArtifact
const revision = { authorUserId: "owner-1", authorConnectionId: null } as Revision

describe("authorOf", () => {
	it("names the owner when the owner wrote it", () => {
		expect(authorOf(revision, artifact)).toBe("Ada")
	})

	it("says a collaborator when somebody else wrote it", () => {
		expect(authorOf({ ...revision, authorUserId: "someone-else" }, artifact)).toBe("a collaborator")
	})

	it("says via a Connection whoever the user behind it was", () => {
		expect(authorOf({ ...revision, authorConnectionId: "conn-1" }, artifact)).toBe("via a Connection")
	})
})
