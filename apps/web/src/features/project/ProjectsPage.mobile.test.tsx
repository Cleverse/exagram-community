import { type Project, type VisibleArtifact } from "@exagram/api-client"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import ProjectsPageMobile from "./ProjectsPage.mobile"

import { QueryKeys } from "@/config/queryKeys"
import { renderMobile } from "@/test/mobile"
import { expectNoProjectCopy } from "@/test/projectCopy"

const project = (id: string, name: string, parentProjectId: string | null = null): Project => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	name,
	parentProjectId,
	publishPolicy: "auto",
	linkPreview: "metadata",
	createdAt: new Date(2026, 0, 1),
})

const artifact = (id: string, projectId: string): VisibleArtifact =>
	({
		id,
		workspaceId: "w1",
		ownerId: "u1",
		projectId,
		kind: "doc",
		title: id,
		access: "owner",
		updatedAt: new Date(2026, 8, 14),
		sharedCount: 0,
		sharedWithNames: [],
	}) as unknown as VisibleArtifact

describe("ProjectsPage (mobile)", () => {
	it("labels the screen Folders and lists each top-level folder with its file count", () => {
		renderMobile(<ProjectsPageMobile />, {
			seed: (client) => {
				client.setQueryData(QueryKeys.projects.list(), [project("p1", "Q4 Sales"), project("p2", "Pricing", "p1")])
				client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [artifact("a1", "p1")])
			},
		})
		expect(screen.getByLabelText("Folders")).toBeInTheDocument()
		const row = screen.getByRole("link", { name: /Q4 Sales/ })
		expect(row).toHaveTextContent("1 file")
		expect(screen.queryByRole("link", { name: /Pricing/ })).not.toBeInTheDocument()
		expectNoProjectCopy()
	})

	it("says there are no folders yet and points at New", async () => {
		const { getByTestId } = renderMobile(<ProjectsPageMobile />)
		expect(screen.getByText("No folders yet. Create one with New.")).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "New" }))
		expect(await screen.findByRole("dialog", { name: "new" })).toBeInTheDocument()
		expect(getByTestId("sheet-params")).toHaveTextContent('{"projectId":null}')
		expectNoProjectCopy()
	})
})
