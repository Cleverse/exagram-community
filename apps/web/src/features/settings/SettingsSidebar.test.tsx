import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PERSONAL, renderSidebar } from "./SettingsSidebar.harness"

import { edition } from "@/edition/edition"

describe("SettingsSidebar", () => {
	it("lists no tab while me is loading, so a Team's menus never flash on a Personal session", () => {
		renderSidebar(true, null)
		expect(screen.queryAllByRole("link", { name: /General|Team|Security|Audit|Notifications/ })).toHaveLength(0)
		expect(screen.queryByText("Personal Workspace")).not.toBeInTheDocument()
	})

	it("offers a person with no Team the Team tab, where they can create one", () => {
		renderSidebar(true, "personal", [PERSONAL])
		const tabs = within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("link")
		expect(tabs.map((link) => link.textContent)).toEqual([
			"General",
			"Team",
			...(edition.notificationSettings ? ["Notifications"] : []),
		])
	})

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
