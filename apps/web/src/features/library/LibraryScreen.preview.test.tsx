import { type VisibleArtifact, type VisibleProject } from "@exagram/api-client"
import { fireEvent, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LibraryScreen } from "./LibraryScreen"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, renderMobile } from "@/test/mobile"

const artifact = (id: string, title: string): VisibleArtifact => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	projectId: null,
	kind: "doc",
	title,
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "manual",
	deletedAt: null,
	createdAt: new Date(2026, 0, 1),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 1,
	updatedAt: new Date(),
	ownerName: "Ada Lovelace",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "northwind.example",
})

describe("LibraryScreen header", () => {
	it("puts the item count after the title instead of in the sort row", () => {
		renderMobile(<LibraryScreen scope="all" />, {
			width: 1440,
			seed: (client) => {
				client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [
					artifact("a1", "Spec"),
					artifact("a2", "Plan"),
				])
				client.setQueryData(QueryKeys.artifacts.list({ scope: "sharedWithMe" }), [])
				client.setQueryData(QueryKeys.artifacts.list({ scope: "mine" }), [])
			},
		})
		const title = screen.getByRole("heading", { name: "All artifacts" })
		expect(title.nextElementSibling).toHaveTextContent(/^2 items$/)
		expect(screen.getByRole("button", { name: "Updated" }).parentElement).not.toHaveTextContent("items")
	})
})

describe("LibraryScreen scopes", () => {
	it.each(["personal", "team"] as const)(
		"lists All, Shared with me and My uploads in a %s Workspace",
		(workspaceKind) => {
			renderMobile(<LibraryScreen scope="all" />, {
				width: 1440,
				seed: (client) => {
					client.setQueryData(QueryKeys.auth.me(), { ...ME, workspaceKind })
					client.setQueryData(QueryKeys.artifacts.list({ scope: "sharedWithMe" }), [])
					client.setQueryData(QueryKeys.artifacts.list({ scope: "mine" }), [])
				},
			})
			const scopes = screen.getByRole("navigation", { name: "Library scope" })
			expect(
				within(scopes)
					.getAllByRole("link")
					.map((link) => link.textContent),
			).toEqual([
				expect.stringContaining("All"),
				expect.stringContaining("Shared with me"),
				expect.stringContaining("My uploads"),
			])
		},
	)
})

describe("LibraryScreen legacy preview", () => {
	it("routes a preview id absent from the library to its artifact page", async () => {
		renderMobile(<LibraryScreen scope="all" />, {
			at: "/?preview=org-file",
			width: 1024,
			seed: (client) => {
				client.setQueryData(QueryKeys.artifacts.list({ scope: "sharedWithMe" }), [])
				client.setQueryData(QueryKeys.artifacts.list({ scope: "mine" }), [])
			},
		})
		expect(await screen.findByTestId("where")).toHaveTextContent("/artifacts/org-file")
	})
})

describe("LibraryScreen search", () => {
	it("opens results outside the current folder", async () => {
		const project: VisibleProject = {
			id: "p1",
			workspaceId: "w1",
			ownerId: ME.id,
			name: "Sales",
			parentProjectId: null,
			publishPolicy: "auto",
			linkPreview: "metadata",
			createdAt: new Date(),
			ownerName: "Ada",
			memberNames: [],
		}
		const inside = { ...artifact("a1", "Inside"), projectId: "p1" }
		const outside = artifact("a2", "Outside")
		const search = vi
			.spyOn(apiClient.artifacts, "search")
			.mockResolvedValue([{ artifactId: "a2" }, { artifactId: "a1" }] as never)
		try {
			renderMobile(<LibraryScreen project={project} />, {
				at: "/projects/p1",
				path: "/projects/:projectId",
				width: 1440,
				seed: (client) => {
					client.setQueryData(QueryKeys.projects.list(), [project])
					client.setQueryData(QueryKeys.artifacts.list({ scope: "all", projectId: "p1" }), [inside])
					client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [outside, inside])
					client.setQueryData(QueryKeys.artifacts.list({ scope: "sharedWithMe" }), [])
					client.setQueryData(QueryKeys.artifacts.list({ scope: "mine" }), [])
				},
			})
			fireEvent.keyDown(document, { key: "k", metaKey: true })
			fireEvent.change(screen.getByRole("searchbox", { name: "Search Workspace" }), { target: { value: "match" } })
			const dialog = within(screen.getByRole("dialog"))
			await dialog.findByText("Outside")
			expect(dialog.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
				expect.stringContaining("Inside"),
				expect.stringContaining("Outside"),
			])
			fireEvent.click(dialog.getByText("Outside"))
			expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a2")
		} finally {
			search.mockRestore()
		}
	})
})
