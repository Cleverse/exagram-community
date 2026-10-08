import { type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ArtifactRow } from "./ArtifactRow"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { clearMock } from "@/mock/store"

const baseArtifact: VisibleArtifact = {
	id: "a1",
	workspaceId: "w1",
	ownerId: "u1",
	projectId: null,
	kind: "doc",
	title: "Spec",
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 3,
	updatedAt: new Date("2026-09-14T00:00:00Z"),
	ownerName: "ada",
	sharedCount: 2,
	sharedWithNames: ["Ada Lovelace", "Grace Hopper"],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "example.com",
}

const renderRow = (
	artifact: VisibleArtifact,
	props?: {
		selected?: boolean
		onSelect?: (artifactId: string) => void
		onOpen?: (artifactId: string) => void
		showProject?: boolean
		showOwner?: boolean
		projectName?: string | null
	},
) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	// The reader owns `baseArtifact`, so its LAST ACTIVITY cell reads "Edited".
	queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1" })

	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter>
					<ul>
						<ArtifactRow artifact={artifact} {...props} />
					</ul>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

describe("ArtifactRow", () => {
	beforeEach(() => {
		clearMock("pinned")
	})

	it("renders the last activity in the trailing meta cell, as Edited for the reader's own file", () => {
		renderRow(baseArtifact)
		expect(screen.getByText(/^Edited /)).toBeInTheDocument()
	})

	it("shows the thinking matrix only while the file is indexing", () => {
		const { unmount } = renderRow({ ...baseArtifact, extractionStatus: "queued" })
		expect(screen.getByRole("img", { name: "Indexing" })).toBeInTheDocument()
		unmount()
		renderRow({ ...baseArtifact, extractionStatus: "done" })
		expect(screen.queryByRole("img", { name: "Indexing" })).not.toBeInTheDocument()
	})

	it("says Updated for a file someone else owns", () => {
		renderRow({ ...baseArtifact, ownerId: "u2" })
		expect(screen.getByText(/^Updated /)).toBeInTheDocument()
	})

	it("draws no avatars, and marks a shared file and its kind quietly after the name", () => {
		renderRow(baseArtifact)
		expect(screen.queryByText("RC")).not.toBeInTheDocument()
		expect(screen.queryByText("KC")).not.toBeInTheDocument()
		const row = screen.getByText("Spec").closest("li")!
		expect(row).toHaveTextContent("MD")
		expect(row).toHaveTextContent("Shared")
	})

	it("leaves an unshared file unmarked", () => {
		renderRow({ ...baseArtifact, sharedWithNames: [], sharedCount: 0, kind: "pdf" })
		const row = screen.getByText("Spec").closest("li")!
		expect(row).toHaveTextContent("PDF")
		expect(row).not.toHaveTextContent("Shared")
	})

	it("keeps the hover actions off the selected row, whose pane carries them", () => {
		renderRow(baseArtifact, { selected: true, onSelect: vi.fn() })
		fireEvent.mouseEnter(screen.getByText("Spec").closest("li")!)
		expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "More actions for Spec" })).not.toBeInTheDocument()
	})

	it("calls onSelect when the row is clicked", () => {
		const onSelect = vi.fn()
		renderRow(baseArtifact, { onSelect })
		fireEvent.click(screen.getByText("Spec").closest("li")!)
		expect(onSelect).toHaveBeenCalledWith("a1")
	})

	it("leaves a ⌘- or Ctrl-click on the name to the browser, so it opens in a new tab", () => {
		const onSelect = vi.fn()
		renderRow(baseArtifact, { onSelect })
		const name = screen.getByRole("link", { name: "Spec" })
		expect(fireEvent.click(name)).toBe(false)
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(fireEvent.click(name, { metaKey: true })).toBe(true)
		expect(fireEvent.click(name, { ctrlKey: true })).toBe(true)
		expect(onSelect).toHaveBeenCalledTimes(1)
	})

	it("calls onOpen when the row is double clicked", () => {
		const onOpen = vi.fn()
		renderRow(baseArtifact, { onOpen })
		fireEvent.doubleClick(screen.getByText("Spec").closest("li")!)
		expect(onOpen).toHaveBeenCalledWith("a1")
	})

	it("marks the selected row", () => {
		const { unmount } = renderRow(baseArtifact, { selected: false, onSelect: vi.fn() })
		expect(screen.getByText("Spec").closest("li")).not.toHaveAttribute("data-selected")
		unmount()
		renderRow(baseArtifact, { selected: true, onSelect: vi.fn() })
		expect(screen.getByText("Spec").closest("li")).toHaveAttribute("data-selected", "true")
	})

	it("shows the project cell only at the library root, and it does not select the row", () => {
		const onSelect = vi.fn()
		renderRow({ ...baseArtifact, projectId: "p1" }, { onSelect, showProject: true, projectName: "Q4 Sales Enablement" })
		fireEvent.click(screen.getByText("Q4 Sales Enablement"))
		expect(onSelect).not.toHaveBeenCalled()
	})

	it("draws the owner as an avatar named on hover only when asked", () => {
		const { unmount } = renderRow({ ...baseArtifact, ownerName: "Ada Lovelace" })
		expect(screen.queryByRole("img", { name: "Ada Lovelace" })).not.toBeInTheDocument()
		unmount()

		renderRow({ ...baseArtifact, ownerName: "Ada Lovelace" }, { showOwner: true })
		const avatar = screen.getByRole("img", { name: "Ada Lovelace" })
		expect(avatar).toHaveAttribute("title", "Ada Lovelace")
		expect(avatar).toHaveTextContent("AL")
	})

	it("selects the row instead of navigating when the title is clicked", () => {
		const onSelect = vi.fn()
		const onOpen = vi.fn()
		renderRow(baseArtifact, { onSelect, onOpen })

		fireEvent.click(screen.getByRole("link", { name: "Spec" }))
		expect(onSelect).toHaveBeenCalledWith("a1")
		expect(onOpen).not.toHaveBeenCalled()
	})

	it("puts the title on a link that opens the artifact from the keyboard", () => {
		const onOpen = vi.fn()
		const onSelect = vi.fn()
		renderRow(baseArtifact, { onOpen, onSelect })

		const link = screen.getByRole("link", { name: "Spec" })
		expect(link).toHaveAttribute("href", "/artifacts/a1")

		fireEvent.keyDown(link, { key: "Enter" })
		expect(onOpen).toHaveBeenCalledWith("a1")
		expect(onSelect).not.toHaveBeenCalled()
	})

	it("reveals the row actions when focus reaches the row", () => {
		renderRow(baseArtifact, { onSelect: vi.fn() })
		expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument()

		fireEvent.focus(screen.getByRole("link", { name: "Spec" }))
		expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Pin Spec" })).toBeInTheDocument()
	})

	it("overlays the row actions on hover and keeps the meta cells underneath", () => {
		renderRow(baseArtifact, { onSelect: vi.fn() })
		fireEvent.mouseEnter(screen.getByText("Spec").closest("li")!)
		const share = screen.getByRole("button", { name: "Share" })
		expect(share).toBeInTheDocument()
		expect(share.parentElement?.className).toContain("absolute")
		expect(screen.getByText(/^Edited /)).toBeInTheDocument()
	})

	it("pins and unpins through the mock store", () => {
		renderRow(baseArtifact, { onSelect: vi.fn() })
		fireEvent.mouseEnter(screen.getByText("Spec").closest("li")!)

		fireEvent.click(screen.getByRole("button", { name: "Pin Spec" }))
		expect(screen.getByRole("button", { name: "Unpin Spec" })).toHaveAttribute("aria-pressed", "true")

		fireEvent.click(screen.getByRole("button", { name: "Unpin Spec" }))
		expect(screen.getByRole("button", { name: "Pin Spec" })).toHaveAttribute("aria-pressed", "false")
	})
})
