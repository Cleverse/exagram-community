import { type ConnectionFolders } from "@exagram/api-client"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ConnectionFoldersForm } from "./ConnectionFoldersDialog"

import { expectNoProjectCopy } from "@/test/projectCopy"

const data: ConnectionFolders = {
	access: "named",
	otherFilesAccess: "none",
	folders: [{ projectId: "parent", access: "view" }],
	projects: [
		{ id: "child", name: "Child", parentProjectId: "parent", ownerName: "Alex", personAccess: "collaborate" },
		{ id: "parent", name: "Parent", parentProjectId: null, ownerName: "Alex", personAccess: "owner" },
		{ id: "view", name: "View only", parentProjectId: null, ownerName: "Alex", personAccess: "view" },
		{ id: "orphan", name: "Orphan", parentProjectId: "unseen", ownerName: "Alex", personAccess: "edit" },
	],
}

const renderForm = (overrides: Partial<ConnectionFolders> = {}) => {
	const onSave = vi.fn()
	render(<ConnectionFoldersForm data={{ ...data, ...overrides }} onClose={vi.fn()} onSave={onSave} />)
	return { onSave }
}

describe("ConnectionFoldersForm", () => {
	it("switches modes and only enables Save after a change", async () => {
		renderForm()
		const save = screen.getByRole("button", { name: "Save" })
		expect(save).toBeDisabled()
		await userEvent.click(screen.getByRole("radio", { name: /All folders/ }))
		expect(save).toBeEnabled()
		await userEvent.click(screen.getByRole("radio", { name: /Only these folders/ }))
		expect(save).toBeDisabled()
	})

	it("disables Can edit for a view-only Project", async () => {
		renderForm()
		await userEvent.click(screen.getByRole("checkbox", { name: "View only" }))
		const select = screen.getByRole("combobox", { name: "View only access" })
		expect(select).toHaveAttribute(
			"title",
			"You only hold Can view here; a Connection cannot be given more than you have.",
		)
		expect(within(select).getByRole("option", { name: "Can edit" })).toBeDisabled()
	})

	it("caps a saved edit entry after the person's Project right drops to view", async () => {
		const { onSave } = renderForm({ folders: [{ projectId: "view", access: "edit" }] })
		expect(screen.getByRole("combobox", { name: "View only access" })).toHaveValue("view")
		await userEvent.click(screen.getByRole("button", { name: "Save" }))
		expect(onSave).toHaveBeenCalledWith({
			access: "named",
			otherFilesAccess: "none",
			folders: [{ projectId: "view", access: "view" }],
		})
	})

	it("shows covered children checked and disables their checkbox", () => {
		renderForm()
		const child = screen.getByRole("checkbox", { name: "Child" })
		expect(child).toBeChecked()
		expect(child).toBeDisabled()
		expect(child).toHaveAttribute("title", "Covered by Parent")
		expect(screen.getByRole("combobox", { name: "Child access" })).toHaveValue("view")
	})

	it("stores a child override and removes it when set back to its parent's right", async () => {
		const { onSave } = renderForm()
		await userEvent.selectOptions(screen.getByRole("combobox", { name: "Child access" }), "edit")
		expect(screen.getByText("New versions only; you cannot add files here")).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Save" }))
		expect(onSave).toHaveBeenCalledWith({
			access: "named",
			otherFilesAccess: "none",
			folders: [
				{ projectId: "child", access: "edit" },
				{ projectId: "parent", access: "view" },
			],
		})
		await userEvent.selectOptions(screen.getByRole("combobox", { name: "Child access" }), "view")
		expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
	})

	it("sends the full state including other files and keeps named entries under All folders", async () => {
		const { onSave } = renderForm()
		await userEvent.click(screen.getByRole("checkbox", { name: /Files not in a folder/ }))
		await userEvent.click(screen.getByRole("radio", { name: /All folders/ }))
		await userEvent.click(screen.getByRole("button", { name: "Save" }))
		expect(onSave).toHaveBeenCalledWith({
			access: "all",
			otherFilesAccess: "view",
			folders: [{ projectId: "parent", access: "view" }],
		})
	})

	it("shows the empty named state", () => {
		renderForm({ folders: [] })
		expect(
			screen.getByText("No folders yet — this Connection is refused everywhere in this Workspace until you add one."),
		).toBeInTheDocument()
		const labels = screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"))
		expect(labels).toContain("Orphan")
		expectNoProjectCopy()
	})

	it("removes explicit child entries when unticking a parent", async () => {
		const { onSave } = renderForm({
			folders: [
				{ projectId: "parent", access: "view" },
				{ projectId: "child", access: "edit" },
			],
		})
		await userEvent.click(screen.getByRole("checkbox", { name: "Parent" }))
		await userEvent.click(screen.getByRole("button", { name: "Save" }))
		expect(onSave).toHaveBeenCalledWith({ access: "named", otherFilesAccess: "none", folders: [] })
	})
})
