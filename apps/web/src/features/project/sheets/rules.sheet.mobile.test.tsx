import { type Project } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { projectFixture, renderSheet } from "@/features/artifact/sheets/sheetHarness"
import { ME } from "@/test/mobile"
import { expectNoProjectCopy } from "@/test/projectCopy"
import { meActingIn, sessionIn } from "@/test/workspaces"

const load = () => import("./rules.sheet.mobile")

const open = (project: Project = projectFixture(), me: object = sessionIn("team", "w1")) =>
	renderSheet("rules", { projectId: project.id }, load, {
		seed: (client) => {
			client.setQueryData(QueryKeys.projects.list(), [project])
			client.setQueryData(QueryKeys.auth.me(), { ...ME, ...me })
		},
	})

afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
})

describe("Rules drawer", () => {
	it.skipIf(!edition.projectRules)(
		"reads the policy, publishing and overwrite switch, with the empty-policy note",
		async () => {
			open()
			const dialog = await screen.findByRole("dialog", { name: "Folder rules" })
			expect(dialog).toHaveTextContent("Q4 planning")
			expect(dialog).toHaveTextContent("No policy yet. Connections read this folder with Workspace defaults.")
			expect(screen.getByText("Policy for Connections")).toBeInTheDocument()
			expect(dialog).not.toHaveTextContent(/\bclients?\b/i)
			expect(dialog).toHaveTextContent("Publish automatically")
			expect(dialog).toHaveTextContent(/Collaborators can upload over existing files.*Off/)
			expectNoProjectCopy()
		},
	)

	it.skipIf(edition.projectRules)(
		"reads and edits only publishing where the edition keeps no local rules",
		async () => {
			const user = userEvent.setup()
			const setPublishPolicy = vi
				.spyOn(apiClient.projects, "setPublishPolicy")
				.mockResolvedValue(projectFixture({ publishPolicy: "manual" }) as never)
			open()
			const dialog = await screen.findByRole("dialog", { name: "Folder rules" })
			expect(dialog).toHaveTextContent("Publish automatically")
			expect(dialog).not.toHaveTextContent(/Policy for Connections|No policy yet/)
			expect(dialog).not.toHaveTextContent("Collaborators can upload over existing files")

			await user.click(screen.getByRole("button", { name: "Edit rules" }))
			expect(screen.queryByRole("textbox", { name: "Policy for Connections" })).not.toBeInTheDocument()
			expect(screen.queryByRole("switch")).not.toBeInTheDocument()
			await user.click(screen.getByRole("radio", { name: /Manual approval only/ }))
			await user.click(screen.getByRole("button", { name: "Save rules" }))
			await waitFor(() => expect(setPublishPolicy).toHaveBeenCalledWith({ projectId: "p1", publishPolicy: "manual" }))
		},
	)

	it.skipIf(!edition.projectRules)("lets the Owner edit and save the rules, with desktop's toast", async () => {
		const user = userEvent.setup()
		const setPublishPolicy = vi
			.spyOn(apiClient.projects, "setPublishPolicy")
			.mockResolvedValue(projectFixture({ publishPolicy: "manual" }) as never)
		open()
		await user.click(await screen.findByRole("button", { name: "Edit rules" }))
		expect(screen.queryByRole("textbox", { name: "Policy for AI clients" })).not.toBeInTheDocument()
		await user.type(screen.getByRole("textbox", { name: "Policy for Connections" }), "Cite every claim.")
		await user.click(screen.getByRole("radio", { name: /Manual approval only/ }))
		await user.click(screen.getByRole("switch", { name: "Collaborators can upload over existing files" }))
		await user.click(screen.getByRole("button", { name: "Save rules" }))

		await waitFor(() => expect(setPublishPolicy).toHaveBeenCalledWith({ projectId: "p1", publishPolicy: "manual" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Settings saved — applies to the next request.")
		const dialog = screen.getByRole("dialog", { name: "Folder rules" })
		expect(await within(dialog).findByText("Cite every claim.")).toBeInTheDocument()
		expect(dialog).toHaveTextContent(/Collaborators can upload over existing files.*On/)
	})

	it("leaves publishing and the overwrite switch out for a Project in a Personal Workspace", async () => {
		open(projectFixture(), sessionIn("personal", "w1"))
		const dialog = await screen.findByRole("dialog", { name: "Folder rules" })
		expect(dialog).not.toHaveTextContent("Publishing")
		expect(dialog).not.toHaveTextContent("Collaborators can upload over existing files")
	})

	it("follows the Project's own Workspace, not the one the session is in", async () => {
		open(projectFixture(), meActingIn({ id: "w2", kind: "personal" }, [{ id: "w1", kind: "team" }]))
		const dialog = await screen.findByRole("dialog", { name: "Folder rules" })
		expect(dialog).toHaveTextContent("Publishing")
		if (edition.projectRules) expect(dialog).toHaveTextContent("Collaborators can upload over existing files")
	})

	it("offers no editing to someone who does not own the Project", async () => {
		open(projectFixture({ ownerId: "someone-else" }))
		await screen.findByRole("dialog", { name: "Folder rules" })
		expect(screen.queryByRole("button", { name: "Edit rules" })).not.toBeInTheDocument()
	})
})
