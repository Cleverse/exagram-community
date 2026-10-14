import { afterEach, describe, expect, it, vi } from "vitest"

import { artifactLinkTarget, openArtifact } from "./openArtifact"

const setBridge = (bridge: unknown) => {
	;(window as { exagram?: unknown }).exagram = bridge
}

describe("openArtifact", () => {
	afterEach(() => {
		setBridge(undefined)
		vi.restoreAllMocks()
	})

	it("gives the file a tab of its own in a Mac app with tabs", () => {
		setBridge({ platform: "macos", bridgeVersion: 3 })
		const open = vi.spyOn(window, "open").mockReturnValue(null)
		const navigate = vi.fn()
		openArtifact(navigate, "a1", { state: { returnTo: "/library" } })
		expect(open).toHaveBeenCalledWith("/artifacts/a1", "_blank")
		expect(navigate).not.toHaveBeenCalled()
		expect(artifactLinkTarget()).toBe("_blank")
	})

	it("navigates in place in a browser and in a Mac app from before tabs", () => {
		for (const bridge of [undefined, { platform: "macos", bridgeVersion: 2 }]) {
			setBridge(bridge)
			const open = vi.spyOn(window, "open").mockReturnValue(null)
			const navigate = vi.fn()
			openArtifact(navigate, "a1", { state: { returnTo: "/library" } })
			expect(navigate).toHaveBeenCalledWith("/artifacts/a1", { state: { returnTo: "/library" } })
			expect(open).not.toHaveBeenCalled()
			expect(artifactLinkTarget()).toBeUndefined()
		}
	})
})
