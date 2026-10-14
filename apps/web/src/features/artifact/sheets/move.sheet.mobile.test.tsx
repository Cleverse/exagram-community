import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { artifactFixture, projectFixture, renderSheet } from "./sheetHarness"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { expectNoProjectCopy } from "@/test/projectCopy"

const load = () => import("./move.sheet.mobile")

const open = () =>
	renderSheet("move", { artifactId: "a1" }, load, {
		seed: (client) => {
			client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [artifactFixture()])
			client.setQueryData(QueryKeys.projects.list(), [
				projectFixture(),
				projectFixture({ id: "p2", name: "Sales" }),
				projectFixture({ id: "p3", name: "Pricing", parentProjectId: "p2" }),
			])
		},
	})

afterEach(() => vi.restoreAllMocks())

describe("Move drawer", () => {
	it("lists No project and every Project, parents before their sub-projects, the current one checked", async () => {
		open()
		const dialog = await screen.findByRole("dialog", { name: "Move to" })
		expect(dialog).toHaveTextContent("Board pack")
		const labels = within(dialog)
			.getAllByRole("button")
			.map((button) => button.textContent)
			.filter((text) => text && !["", "Close"].includes(text))
		expect(labels).toEqual(["No folder", "Q4 planning", "Sales", "Pricing"])
		// The check is the only thing marking the current place, so it must sit on Q4 planning alone.
		expect(within(dialog).getByRole("button", { name: "Q4 planning" }).querySelectorAll("svg")).toHaveLength(2)
		expect(within(dialog).getByRole("button", { name: "Sales" }).querySelectorAll("svg")).toHaveLength(1)
		expectNoProjectCopy()
	})

	it("moves in one tap with desktop's toast, then closes", async () => {
		const user = userEvent.setup()
		const move = vi.spyOn(apiClient.artifacts, "move").mockResolvedValue(undefined as never)
		open()
		await user.click(await screen.findByRole("button", { name: "Pricing" }))
		await waitFor(() => expect(move).toHaveBeenCalledWith({ artifactId: "a1", projectId: "p3" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Moved Board pack to Sales › Pricing")
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("takes a file out of its Project with No project", async () => {
		const user = userEvent.setup()
		const move = vi.spyOn(apiClient.artifacts, "move").mockResolvedValue(undefined as never)
		open()
		await user.click(await screen.findByRole("button", { name: "No folder" }))
		await waitFor(() => expect(move).toHaveBeenCalledWith({ artifactId: "a1", projectId: null }))
		expect(await screen.findByRole("status")).toHaveTextContent("Board pack is no longer in a folder")
	})

	it("closes without moving when the current place is tapped", async () => {
		const user = userEvent.setup()
		const move = vi.spyOn(apiClient.artifacts, "move")
		open()
		await user.click(await screen.findByRole("button", { name: "Q4 planning" }))
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(move).not.toHaveBeenCalled()
	})

	it("toasts a refused move unchanged and stays open", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.artifacts, "move").mockRejectedValue(new Error("Only the Owner can move this file"))
		open()
		await user.click(await screen.findByRole("button", { name: "Sales" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Only the Owner can move this file")
		expect(screen.getByRole("dialog", { name: "Move to" })).toBeInTheDocument()
	})
})
