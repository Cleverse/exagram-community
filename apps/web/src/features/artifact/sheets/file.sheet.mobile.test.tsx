import { type VisibleArtifact } from "@exagram/api-client"
import { type QueryClient } from "@tanstack/react-query"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { artifactFixture, projectFixture, renderSheet } from "./sheetHarness"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"

const load = () => import("./file.sheet.mobile")

const seedWith = (artifact: VisibleArtifact) => (client: QueryClient) => {
	client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [artifact])
	client.setQueryData(QueryKeys.projects.list(), [projectFixture()])
}

const open = (artifact: VisibleArtifact = artifactFixture(), at = "/") =>
	renderSheet("file", { artifactId: artifact.id }, load, { path: "*", at, seed: seedWith(artifact) })

afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
})

describe("File drawer", () => {
	it("titles itself with the file and its Project and version, and lists the Owner's actions", async () => {
		open()
		const dialog = await screen.findByRole("dialog", { name: "Board pack" })
		expect(dialog).toHaveTextContent("Q4 planning · v3")
		const labels = ["Open", "Share", "Copy link", ...(edition.pins ? ["Pin"] : []), "Move to…", "Version history"]
		for (const label of [...labels, "Details", "Download"]) {
			expect(within(dialog).getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument()
		}
		expect(within(dialog).getByRole("button", { name: "Delete" })).toBeInTheDocument()
	})

	it.skipIf(edition.pins)("offers no Pin where the edition keeps no pins", async () => {
		open()
		const dialog = await screen.findByRole("dialog", { name: "Board pack" })
		expect(within(dialog).queryByRole("button", { name: /^Pin/ })).not.toBeInTheDocument()
	})

	it("has no Download row when the Owner turned download off", async () => {
		open(artifactFixture({ access: "view", projectId: null, canDownload: false }))
		const dialog = await screen.findByRole("dialog", { name: "Board pack" })
		expect(within(dialog).queryByRole("button", { name: "Download" })).not.toBeInTheDocument()
		expect(within(dialog).getByRole("button", { name: "Details" })).toBeInTheDocument()
	})

	it("hides Move, Version history and Delete from someone who does not own the file", async () => {
		open(artifactFixture({ access: "edit", projectId: null }))
		const dialog = await screen.findByRole("dialog", { name: "Board pack" })
		expect(dialog).toHaveTextContent("No folder · v3")
		expect(within(dialog).queryByRole("button", { name: /Move to/ })).not.toBeInTheDocument()
		expect(within(dialog).queryByRole("button", { name: /Version history/ })).not.toBeInTheDocument()
		expect(within(dialog).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument()
		expect(within(dialog).getByRole("button", { name: "Details" })).toBeInTheDocument()
	})

	it("steps into Share, Move, Version history and Details for this file", async () => {
		const user = userEvent.setup()
		open()
		const steps: [RegExp, string, string][] = [
			[/^Share/, "share", '{"target":{"kind":"artifact","id":"a1"}}'],
			[/^Move to/, "move", '{"artifactId":"a1"}'],
			[/^Version history/, "history", '{"artifactId":"a1"}'],
			[/^Details/, "details", '{"artifactId":"a1"}'],
		]
		for (const [row, kind, params] of steps) {
			await user.click(await screen.findByRole("button", { name: row }))
			expect(await screen.findByRole("dialog", { name: kind })).toHaveTextContent(params)
			await user.click(screen.getByRole("button", { name: "Back" }))
		}
	})

	it("opens the file's reading view", async () => {
		const user = userEvent.setup()
		open()
		await user.click(await screen.findByRole("button", { name: "Open" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1")
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})

	it.skipIf(!edition.pins)("pins the file, toasts as desktop does, and offers Unpin next time", async () => {
		const user = userEvent.setup()
		open()
		await user.click(await screen.findByRole("button", { name: "Pin" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Pinned")
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(localStorage.getItem("exagram.mock.pinned")).toContain("a1")
	})

	it("asks before deleting, and deletes only on the confirmation", async () => {
		const user = userEvent.setup()
		const softDelete = vi.spyOn(apiClient.artifacts, "softDelete").mockResolvedValue(undefined as never)
		open(artifactFixture(), "/artifacts/a1")
		await user.click(await screen.findByRole("button", { name: "Delete" }))
		expect(await screen.findByRole("dialog", { name: "Delete this file" })).toHaveTextContent(
			edition.copy.deleteArtifact.confirm,
		)
		expect(softDelete).not.toHaveBeenCalled()

		await user.click(screen.getByRole("button", { name: "Cancel" }))
		await user.click(await screen.findByRole("button", { name: "Delete" }))
		await user.click(
			within(await screen.findByRole("dialog", { name: "Delete this file" })).getByRole("button", { name: "Delete" }),
		)

		await waitFor(() => expect(softDelete).toHaveBeenCalledWith({ artifactId: "a1" }))
		expect(await screen.findByRole("status")).toHaveTextContent(edition.copy.deleteArtifact.done("Board pack"))
		// The file on screen is gone, so the reading view gives way to the library.
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/))
	})

	it("says so when the file is no longer there", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new Error("Artifact unavailable"))
		renderSheet("file", { artifactId: "gone" }, load)
		expect(await screen.findByRole("dialog", { name: "File unavailable" })).toBeInTheDocument()
	})
})
