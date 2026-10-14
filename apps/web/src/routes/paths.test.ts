import { describe, expect, it } from "vitest"

import { legacyPreviewTarget, paths, previewIdOf, projectIdOf, withPreview } from "./paths"

describe("preview addresses", () => {
	it("previews a file as ?preview=<id> on the list it sits in, keeping the list's other parameters", () => {
		expect(withPreview("/", "", "a1")).toBe("/?preview=a1")
		expect(withPreview("/projects/p1", "?panel=history", "a1")).toBe("/projects/p1?panel=history&preview=a1")
		expect(withPreview("/mine", "?preview=a1&x=1", null)).toBe("/mine?x=1")
		expect(previewIdOf("?preview=a2")).toBe("a2")
		expect(previewIdOf("")).toBeNull()
	})

	it("gives an Artifact one page of its own, the address a share carries", () => {
		expect(paths.artifact("a1")).toBe("/artifacts/a1")
	})

	it("gives the sign-in email's link a page of its own under sign-in", () => {
		expect(paths.emailSignIn("T0ken")).toBe("/signin/email/T0ken")
		expect(paths.emailSignIn(":token")).toBe("/signin/email/:token")
	})

	it("reads the Project a list path shows", () => {
		expect(projectIdOf("/projects/p1")).toBe("p1")
		expect(projectIdOf("/projects/p1/")).toBe("p1")
		expect(projectIdOf("/")).toBeNull()
	})

	it("sends a preview's former path addresses to ?preview, and old full-view links to the page", () => {
		expect(legacyPreviewTarget("/shared/artifacts/a1", "")).toBe("/shared?preview=a1")
		expect(legacyPreviewTarget("/projects/p1/artifacts/a1", "?panel=history")).toBe(
			"/projects/p1?panel=history&preview=a1",
		)
		expect(legacyPreviewTarget("/activity/artifacts/a1", "?scope=team")).toBe("/activity?scope=team&preview=a1")
		expect(legacyPreviewTarget("/pending/artifacts/a1", "")).toBe("/activity?preview=a1")
		expect(legacyPreviewTarget("/mine/artifacts/a1", "?view=full")).toBe("/artifacts/a1")
		expect(legacyPreviewTarget("/projects/p1/artifacts/a1", "?expanded=1")).toBe("/artifacts/a1")
		expect(legacyPreviewTarget("/projects/p1/artifacts/a1", "?expanded=1&panel=history")).toBe(
			"/artifacts/a1?panel=history",
		)
		expect(legacyPreviewTarget("/artifact/a1", "")).toBeNull()
	})

	it("keeps this week's Context address bare", () => {
		expect(paths.contextWeek(0)).toBe("/context")
		expect(paths.contextWeek(2)).toBe("/context?week=2")
	})
})
