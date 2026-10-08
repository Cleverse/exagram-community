import { type VisibleArtifact } from "@exagram/api-client"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LibraryScreen } from "./LibraryScreen"

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
