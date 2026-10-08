import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { renderSidebar } from "./SettingsSidebar.harness"

describe("SettingsSidebar", () => {
	it("leaves Security out until the redaction state has loaded", () => {
		renderSidebar(null)
		expect(screen.queryByRole("link", { name: "Security" })).not.toBeInTheDocument()
	})

	it("drops Security once the api says redaction is switched off", () => {
		renderSidebar(false)
		expect(screen.queryByRole("link", { name: "Security" })).not.toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Audit" })).toBeInTheDocument()
	})
})
