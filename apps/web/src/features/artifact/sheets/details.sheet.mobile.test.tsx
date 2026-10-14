import { type VisibleArtifact } from "@exagram/api-client"
import { screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { artifactFixture, projectFixture, renderSheet, revisionFixture } from "./sheetHarness"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME } from "@/test/mobile"
import { expectNoProjectCopy } from "@/test/projectCopy"

const load = () => import("./details.sheet.mobile")

const open = (artifact: VisibleArtifact) =>
	renderSheet("details", { artifactId: artifact.id }, load, {
		seed: (client) => {
			client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [artifact])
			client.setQueryData(QueryKeys.projects.list(), [projectFixture()])
			client.setQueryData(QueryKeys.revisions.list(artifact.id), [revisionFixture(3, { bytes: 5 * 1024 * 1024 })])
			client.setQueryData(QueryKeys.connections.list(), [
				{ id: "c1", name: "Claude Desktop", workspaceId: ME.workspaceId, revokedAt: null },
				{ id: "c2", name: "Old client", workspaceId: ME.workspaceId, revokedAt: new Date("2026-01-01") },
			])
		},
	})

const valueOf = (label: string) => screen.getByText(label).nextElementSibling?.textContent

afterEach(() => vi.restoreAllMocks())

describe("Details drawer", () => {
	it("shows the file's facts, size included for the Owner", async () => {
		open(
			artifactFixture({
				sourceFilename: "board-pack.md",
				sharedWithNames: ["Grace Hopper", "Linus Pauling"],
			}),
		)
		expect(await screen.findByRole("dialog", { name: "Details" })).toHaveTextContent("Board pack")
		expect(valueOf("Original filename")).toBe("board-pack.md")
		expect(valueOf("Folder")).toBe("Q4 planning")
		expect(valueOf("Owner")).toBe("Ada Lovelace")
		expect(valueOf("Shared with")).toBe("Grace Hopper, Linus Pauling")
		expect(valueOf("Revision")).toBe("v3 · current")
		expect(valueOf("Size")).toBe("5.0 MB")
		expect(valueOf("Connections")).toBe("Claude Desktop")
		expectNoProjectCopy()
	})

	it("leaves out what a non-Owner cannot know", async () => {
		open(artifactFixture({ access: "view", projectId: null }))
		await screen.findByRole("dialog", { name: "Details" })
		expect(valueOf("Folder")).toBe("No folder")
		expect(valueOf("Shared with")).toBe("No one else")
		expect(screen.queryByText("Size")).not.toBeInTheDocument()
		expect(screen.queryByText("Original filename")).not.toBeInTheDocument()
	})

	it("describes link access without showing a guest list", async () => {
		const file = artifactFixture({ access: "view", generalAccess: "anyone", sharedWithNames: [] })
		open(file)
		await screen.findByRole("dialog", { name: "Details" })
		expect(valueOf("Shared with")).toBe("Anyone with the link")
	})

	it("shows Connections as loading, never None, while the list is pending", async () => {
		vi.spyOn(apiClient.connections, "list").mockReturnValue(new Promise(() => undefined) as never)
		renderSheet("details", { artifactId: "a1" }, load, {
			seed: (client) => {
				client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [artifactFixture()])
				client.setQueryData(QueryKeys.projects.list(), [projectFixture()])
				client.setQueryData(QueryKeys.revisions.list("a1"), [revisionFixture(3)])
			},
		})
		const drawer = await screen.findByRole("dialog", { name: "Details" })
		expect(within(drawer).getByRole("status")).toHaveTextContent("Loading Connections…")
		expect(within(drawer).queryByText("None")).not.toBeInTheDocument()
	})
})
