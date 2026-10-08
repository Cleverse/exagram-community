import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { empty, renderView } from "./ProjectSettingsDialog.harness"

import { policyTemplate } from "@/mock/policyDraft"

describe("ProjectSettingsDialogView", () => {
	it("leaves the overwrite switch and Published version out in a Personal Workspace, saving their defaults", async () => {
		const { onSave } = renderView({}, "personal")
		expect(screen.queryByRole("switch")).not.toBeInTheDocument()
		expect(screen.queryByRole("radio")).not.toBeInTheDocument()
		expect(screen.queryByText("Published version")).not.toBeInTheDocument()
		expect(screen.queryByText(/Private until you invite someone/)).not.toBeInTheDocument()

		await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "Q4")
		await userEvent.click(screen.getByRole("button", { name: "Create project" }))
		expect(onSave).toHaveBeenCalledWith({ name: "Q4", policy: "", overwrite: false, publish: "auto" })
	})

	it("keeps the primary button disabled until the name is not blank", async () => {
		renderView()
		const create = screen.getByRole("button", { name: "Create project" })
		expect(create).toBeDisabled()

		await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "  ")
		expect(create).toBeDisabled()

		await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "Q4 Sales Enablement")
		expect(create).toBeEnabled()
	})

	it("reports the draft the user filled in", async () => {
		const { onSave } = renderView()
		await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "Q4")
		await userEvent.click(screen.getByRole("switch"))
		await userEvent.click(screen.getByRole("radio", { name: /Manual approval only/ }))
		await userEvent.click(screen.getByRole("button", { name: "Create project" }))

		expect(onSave).toHaveBeenCalledWith({ name: "Q4", policy: "", overwrite: true, publish: "manual" })
	})

	it("offers exactly the two real publish policies, defaulting to automatic with the overwrite switch off", () => {
		renderView()
		expect(screen.getAllByRole("radio")).toHaveLength(2)
		expect(screen.getByRole("radio", { name: /Publish automatically/ })).toBeChecked()
		expect(screen.queryByRole("radio", { name: /editor can approve/i })).not.toBeInTheDocument()
		expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false")
	})

	it("drafts a policy from the name and drops the note once the text is edited", async () => {
		renderView()
		await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "Q4")

		await userEvent.click(screen.getByRole("button", { name: "Draft with AI" }))
		expect(screen.getByRole("button", { name: "Drafting…" })).toBeDisabled()

		const note = await screen.findByText(/Drafted from the project name/, undefined, { timeout: 3000 })
		expect(screen.getByRole("textbox", { name: "Policy" })).toHaveValue(policyTemplate("Q4"))
		expect(screen.getByRole("button", { name: "Redraft with AI" })).toBeEnabled()

		await userEvent.type(screen.getByRole("textbox", { name: "Policy" }), "!")
		expect(note).not.toBeInTheDocument()
	})

	it("labels the edit mode with the project name and the settings footnote", () => {
		renderView({ mode: "edit", initial: { ...empty, name: "Atlas" } })
		expect(screen.getByRole("dialog", { name: "Project settings" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Settings · Atlas" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled()
		expect(screen.getByText("Changes apply to the next request from any client.")).toBeInTheDocument()
	})
})
