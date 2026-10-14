import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { empty, renderView } from "./ProjectSettingsDialog.harness"

import { DRAFT_DELAY_MS, policyTemplate } from "@/mock/policyDraft"
import { expectNoProjectCopy } from "@/test/projectCopy"

afterEach(() => vi.useRealTimers())

describe("ProjectSettingsDialogView", () => {
	it("leaves the overwrite switch and Published version out in a Personal Workspace, saving their defaults", async () => {
		const { onSave } = renderView({}, "personal")
		expect(screen.queryByRole("switch")).not.toBeInTheDocument()
		expect(screen.queryByRole("radio")).not.toBeInTheDocument()
		expect(screen.queryByText("Published version")).not.toBeInTheDocument()
		expect(screen.queryByText(/Private until you invite someone/)).not.toBeInTheDocument()

		await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "Q4")
		await userEvent.click(screen.getByRole("button", { name: "Create folder" }))
		expect(onSave).toHaveBeenCalledWith({ name: "Q4", policy: "", overwrite: false, publish: "auto" })
	})

	it.each(["create", "edit"] as const)("says folder, never project, in %s mode", (mode) => {
		renderView({ mode, initial: { ...empty, name: "Aida" } })
		expectNoProjectCopy()
	})

	it("keeps the primary button disabled until the name is not blank", async () => {
		renderView()
		const create = screen.getByRole("button", { name: "Create folder" })
		expect(create).toBeDisabled()

		await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "  ")
		expect(create).toBeDisabled()

		await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "Q4 Sales Enablement")
		expect(create).toBeEnabled()
	})

	it("reports the draft the user filled in", async () => {
		const { onSave } = renderView()
		await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "Q4")
		await userEvent.click(screen.getByRole("switch"))
		await userEvent.click(screen.getByRole("radio", { name: /Manual approval only/ }))
		await userEvent.click(screen.getByRole("button", { name: "Create folder" }))

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
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		renderView()
		await user.type(screen.getByRole("textbox", { name: "Folder name" }), "Q4")

		await user.click(screen.getByRole("button", { name: "Draft with AI" }))
		expect(screen.getByRole("button", { name: "Drafting…" })).toBeDisabled()
		await act(() => vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS))

		const note = await screen.findByText(/Drafted from the folder name/, undefined, { timeout: 3000 })
		expect(screen.getByRole("textbox", { name: "Policy" })).toHaveValue(policyTemplate("Q4"))
		expect(screen.getByRole("button", { name: "Redraft with AI" })).toBeEnabled()

		await user.type(screen.getByRole("textbox", { name: "Policy" }), "!")
		expect(note).not.toBeInTheDocument()
	})

	it("labels the edit mode with the project name and the settings footnote", () => {
		renderView({ mode: "edit", initial: { ...empty, name: "Atlas" } })
		expect(screen.getByRole("dialog", { name: "Folder settings" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Settings · Atlas" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled()
		expect(screen.getByText("Changes apply to the next request from any Connection.")).toBeInTheDocument()
	})

	it("drops the Connection footnote where a Personal folder's settings hold only its name", () => {
		renderView({ mode: "edit", initial: { ...empty, name: "Atlas" }, localRules: false }, "personal")
		const dialog = screen.getByRole("dialog", { name: "Folder settings" })
		expect(screen.getByRole("textbox", { name: "Folder name" })).toHaveValue("Atlas")
		expect(screen.queryByRole("textbox", { name: "Policy" })).not.toBeInTheDocument()
		expect(dialog).not.toHaveTextContent(/Connection/)
	})

	it("keeps the Connection footnote on a Team folder's Published version where there are no local rules", () => {
		renderView({ mode: "edit", initial: { ...empty, name: "Atlas" }, localRules: false }, "team")
		expect(screen.getByText("Changes apply to the next request from any Connection.")).toBeInTheDocument()
		expect(screen.getByText("Published version")).toBeInTheDocument()
	})

	it("names Connections, not clients, wherever it says who follows the policy and reads the published version", () => {
		renderView({ mode: "edit", initial: { ...empty, name: "Aida" } })
		const dialog = screen.getByRole("dialog", { name: "Folder settings" })
		expect(dialog).toHaveTextContent(
			"Instructions every Connection and collaborator follows when reading or writing here. Write it like a prompt.",
		)
		expect(dialog).toHaveTextContent("What has to happen before a new upload becomes the version Connections read.")
		expect(dialog).not.toHaveTextContent(/\bclients?\b/i)
	})

	it("says only Connections follow the policy in a Personal Workspace, which has no collaborator", () => {
		renderView({ mode: "edit", initial: { ...empty, name: "Aida" } }, "personal")
		const dialog = screen.getByRole("dialog", { name: "Folder settings" })
		expect(dialog).toHaveTextContent(
			"Instructions every Connection follows when reading or writing here. Write it like a prompt.",
		)
		expect(dialog).not.toHaveTextContent(/\bclients?\b/i)
	})
})
