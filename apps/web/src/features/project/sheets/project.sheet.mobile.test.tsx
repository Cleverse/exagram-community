import { type Project } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { artifactFixture, projectFixture, renderSheet } from "@/features/artifact/sheets/sheetHarness"
import { ME } from "@/test/mobile"
import { expectNoProjectCopy } from "@/test/projectCopy"
import { sessionIn } from "@/test/workspaces"

const load = () => import("./project.sheet.mobile")

const open = (project: Project = projectFixture(), at = "/") =>
	renderSheet("project", { projectId: project.id }, load, {
		path: "*",
		at,
		seed: (client) => {
			client.setQueryData(QueryKeys.projects.list(), [project])
			client.setQueryData(QueryKeys.artifacts.list({ scope: "all", projectId: project.id }), [
				artifactFixture(),
				artifactFixture({ id: "a2" }),
			])
		},
	})

afterEach(() => vi.restoreAllMocks())

describe("Project drawer", () => {
	it("titles itself with the Project and its file count, and lists the Owner's actions", async () => {
		open()
		const dialog = await screen.findByRole("dialog", { name: "Q4 planning" })
		expect(dialog).toHaveTextContent("2 files")
		expect(within(dialog).getByRole("button", { name: /Folder rules/ })).toHaveTextContent("Automatic")
		for (const label of [/^Share folder/, /^Rename/, /^New subfolder/, /^Delete folder/]) {
			expect(within(dialog).getByRole("button", { name: label })).toBeInTheDocument()
		}
		expectNoProjectCopy()
	})

	it("names no publish mode on the Rules row in a Personal Workspace", async () => {
		renderSheet("project", { projectId: "p1" }, load, {
			path: "*",
			at: "/",
			seed: (client) => {
				client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn("personal", "w1") })
				client.setQueryData(QueryKeys.projects.list(), [projectFixture()])
				client.setQueryData(QueryKeys.artifacts.list({ scope: "all", projectId: "p1" }), [])
			},
		})
		const dialog = await screen.findByRole("dialog", { name: "Q4 planning" })
		if (!edition.projectRules) {
			// Without the policy this browser keeps, a Personal Workspace's folder has no rules to show.
			expect(within(dialog).queryByRole("button", { name: /Folder rules/ })).not.toBeInTheDocument()
			return
		}
		const rules = within(dialog).getByRole("button", { name: /Folder rules/ })
		expect(rules).not.toHaveTextContent("Automatic")
		expect(rules).toHaveTextContent("Folder rules")
	})

	it("steps into Share, Rules and New sub-project for this Project", async () => {
		const user = userEvent.setup()
		open()
		const steps: [RegExp, string, string][] = [
			[/^Share folder/, "share", '{"target":{"kind":"project","id":"p1"}}'],
			[/^Folder rules/, "rules", '{"projectId":"p1"}'],
			[/^New subfolder/, "newProject", '{"parentId":"p1"}'],
		]
		for (const [row, kind, params] of steps) {
			await user.click(await screen.findByRole("button", { name: row }))
			expect(await screen.findByRole("dialog", { name: kind })).toHaveTextContent(params)
			await user.click(screen.getByRole("button", { name: "Back" }))
		}
	})

	it("shows only Share and Rules to someone who does not own it", async () => {
		open(projectFixture({ ownerId: "someone-else" }))
		const dialog = await screen.findByRole("dialog", { name: "Q4 planning" })
		expect(
			within(dialog)
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label") ?? button.textContent),
		).toEqual(["Close", "Share folder", "Folder rulesAutomatic"])
	})

	it("renames in place with a toast", async () => {
		const user = userEvent.setup()
		const rename = vi.spyOn(apiClient.projects, "rename").mockResolvedValue(undefined as never)
		open()
		await user.click(await screen.findByRole("button", { name: /^Rename/ }))
		const field = screen.getByRole("textbox", { name: "Folder name" })
		await user.clear(field)
		await user.type(field, "Q4 board{Enter}")
		await waitFor(() => expect(rename).toHaveBeenCalledWith({ projectId: "p1", name: "Q4 board" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Renamed to Q4 board")
	})

	it("asks before deleting, and leaves the Project page once it is gone", async () => {
		const user = userEvent.setup()
		const remove = vi.spyOn(apiClient.projects, "remove").mockResolvedValue(undefined as never)
		open(projectFixture(), "/projects/p1")
		await user.click(await screen.findByRole("button", { name: /^Delete folder/ }))
		const confirm = await screen.findByRole("dialog", { name: "Delete folder" })
		expect(remove).not.toHaveBeenCalled()
		await user.click(within(confirm).getByRole("button", { name: "Delete" }))
		await waitFor(() => expect(remove).toHaveBeenCalledWith({ projectId: "p1" }))
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/))
	})

	it("toasts the server's refusal of a Project that still holds files", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.projects, "remove").mockRejectedValue(new Error("Move or delete its files first"))
		open()
		await user.click(await screen.findByRole("button", { name: /^Delete folder/ }))
		await user.click(
			within(await screen.findByRole("dialog", { name: "Delete folder" })).getByRole("button", { name: "Delete" }),
		)
		expect(await screen.findByRole("status")).toHaveTextContent("Move or delete its files first")
		expect(await screen.findByRole("dialog", { name: "Q4 planning" })).toBeInTheDocument()
	})
})
