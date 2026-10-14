import { type Access, NO_CAPABILITIES, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useArtifactActions } from "./useArtifactActions"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { authProviders } from "@/test/authProviders"

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
	ownerName: "owner",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "northwind.example",
}

const Harness = ({ artifact }: { artifact: VisibleArtifact }) => {
	const actions = useArtifactActions({
		artifact,
		onFileInfo: () => undefined,
		onHistory: () => undefined,
		onDeleted: () => undefined,
	})
	return (
		<>
			<ul>
				{actions.items.map((item) => (
					<li key={item.label}>
						<button onClick={() => item.onSelect()}>{item.label}</button>
					</li>
				))}
			</ul>
			{actions.deleteItem ? (
				<button onClick={() => actions.deleteItem?.onSelect()}>{actions.deleteItem.label}</button>
			) : null}
			<button onClick={actions.copyLink}>Copy link</button>
			{actions.dialogs}
		</>
	)
}

const renderHarness = (artifact: VisibleArtifact = baseArtifact) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(
		QueryKeys.auth.providers(),
		authProviders({ aiEdit: false, edition: "community", capabilities: NO_CAPABILITIES }),
	)
	return {
		...render(
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<Harness artifact={artifact} />
				</ToastProvider>
			</QueryClientProvider>,
		),
		queryClient,
	}
}

describe("useArtifactActions delete confirmation", () => {
	let softDelete: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		softDelete = vi.spyOn(apiClient.artifacts, "softDelete").mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("does not delete until the dialog's Delete button is pressed", async () => {
		renderHarness()
		fireEvent.click(screen.getByRole("button", { name: "Delete this file" }))

		expect(screen.getByRole("dialog", { name: "Delete this file" })).toBeInTheDocument()
		expect(softDelete).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole("button", { name: "Delete" }))
		await waitFor(() => expect(softDelete).toHaveBeenCalledWith({ artifactId: "a1" }))
	})

	it("leaves the mutation uncalled when Cancel is pressed", () => {
		renderHarness()
		fireEvent.click(screen.getByRole("button", { name: "Delete this file" }))
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

		expect(screen.queryByRole("dialog", { name: "Delete this file" })).not.toBeInTheDocument()
		expect(softDelete).not.toHaveBeenCalled()
	})
})

describe("useArtifactActions menu items by access", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	const withAccess = (access: Access, projectId: string | null = null): VisibleArtifact => ({
		...baseArtifact,
		access,
		projectId,
	})

	it("gives an owner every item, including Revision history, Move project and Delete", () => {
		renderHarness(withAccess("owner"))

		for (const label of [
			...(edition.tags ? ["Tags…"] : []),
			...(edition.pins ? ["Pin for org"] : []),
			"File info",
			"Duplicate",
			"Download",
			"Upload a new version",
			"Move to folder…",
			"Delete this file",
		]) {
			expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
		}
		expect(screen.getByText(/Revision history/)).toBeInTheDocument()
	})

	it("leaves Download and Duplicate out for a reader whose Owner turned download off, and keeps the rest", () => {
		renderHarness({ ...withAccess("view"), canDownload: false })

		expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument()
		// A duplicate is a copy the reader owns and can then download.
		expect(screen.queryByRole("button", { name: /Duplicat/ })).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "File info" })).toBeInTheDocument()
		if (edition.pins) expect(screen.getByRole("button", { name: "Pin for org" })).toBeInTheDocument()
	})

	it("gives an edit grantee write actions but not Revision history, Move project or Delete", () => {
		renderHarness(withAccess("edit"))

		expect(screen.getByRole("button", { name: "Upload a new version" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument()
		expect(screen.queryByText(/Revision history/)).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Move to folder…" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Delete this file" })).not.toBeInTheDocument()
	})

	it("limits a view grantee to read-only and no-project-move actions", () => {
		renderHarness(withAccess("view"))

		if (edition.tags) expect(screen.getByRole("button", { name: "Tags…" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "File info" })).toBeInTheDocument()
		if (edition.pins) expect(screen.getByRole("button", { name: "Pin for org" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument()
		// The API only refuses Duplicate for a view grantee when the artifact sits inside a Project
		// the grantee does not own; a project-less artifact has no such check to trip.
		expect(screen.getByRole("button", { name: "Duplicate" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Upload a new version" })).not.toBeInTheDocument()
		expect(screen.queryByText(/Revision history/)).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Move to folder…" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Delete this file" })).not.toBeInTheDocument()
	})

	it.skipIf(edition.pins || edition.tags)("offers no Pin or Tags where the edition keeps neither", () => {
		renderHarness(withAccess("owner"))

		expect(screen.queryByRole("button", { name: /^Pin/ })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Tags…" })).not.toBeInTheDocument()
	})

	it("hides Duplicate for a view grantee once the artifact lives inside a Project", () => {
		renderHarness(withAccess("view", "p1"))
		expect(screen.queryByRole("button", { name: "Duplicate" })).not.toBeInTheDocument()
	})
})

describe("useArtifactActions download", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	const binaryArtifact: VisibleArtifact = { ...baseArtifact, kind: "pdf" }

	it("opens the tab before the token resolves, then points it at the token url", async () => {
		const tab = { opener: undefined as unknown, location: { href: "" }, close: vi.fn() }
		const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
		let resolveToken: (value: { url: string; revisionId: string; expiresInSeconds: number }) => void = () => undefined
		vi.spyOn(apiClient.revisions, "bodyToken").mockReturnValue(
			new Promise((resolve) => {
				resolveToken = resolve
			}),
		)

		renderHarness(binaryArtifact)
		fireEvent.click(screen.getByRole("button", { name: "Download" }))

		expect(open).toHaveBeenCalledWith("", "_blank")
		expect(tab.opener).toBeNull()
		expect(tab.location.href).toBe("")

		resolveToken({ url: "https://usercontent.example/uc/token", revisionId: "r1", expiresInSeconds: 60 })
		await waitFor(() => expect(tab.location.href).toBe("https://usercontent.example/uc/token"))
	})

	it("closes the tab and toasts when the token request fails", async () => {
		const tab = { opener: undefined as unknown, location: { href: "" }, close: vi.fn() }
		vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
		vi.spyOn(apiClient.revisions, "bodyToken").mockRejectedValue(new Error("no token for you"))

		renderHarness(binaryArtifact)
		fireEvent.click(screen.getByRole("button", { name: "Download" }))

		await waitFor(() => expect(tab.close).toHaveBeenCalled())
		expect(await screen.findByText("no token for you")).toBeInTheDocument()
	})

	it("toasts when the popup is blocked and never requests a token", async () => {
		vi.spyOn(window, "open").mockReturnValue(null)
		const bodyToken = vi.spyOn(apiClient.revisions, "bodyToken")

		renderHarness(binaryArtifact)
		fireEvent.click(screen.getByRole("button", { name: "Download" }))

		expect(await screen.findByText(/Allow pop-ups for this site/)).toBeInTheDocument()
		expect(bodyToken).not.toHaveBeenCalled()
	})

	it("downloads an html artifact via the token tab, not revisions.text, with download=1 appended", async () => {
		const tab = { opener: undefined as unknown, location: { href: "" }, close: vi.fn() }
		const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
		const text = vi.spyOn(apiClient.revisions, "text")
		let resolveToken: (value: { url: string; revisionId: string; expiresInSeconds: number }) => void = () => undefined
		vi.spyOn(apiClient.revisions, "bodyToken").mockReturnValue(
			new Promise((resolve) => {
				resolveToken = resolve
			}),
		)

		renderHarness({ ...baseArtifact, kind: "html" })
		fireEvent.click(screen.getByRole("button", { name: "Download" }))

		expect(open).toHaveBeenCalledWith("", "_blank")
		expect(tab.opener).toBeNull()

		resolveToken({ url: "https://usercontent.example/uc/token", revisionId: "r1", expiresInSeconds: 60 })
		await waitFor(() => expect(tab.location.href).toBe("https://usercontent.example/uc/token?download=1"))
		expect(text).not.toHaveBeenCalled()
	})
})

describe("useArtifactActions duplicate", () => {
	afterEach(() => vi.restoreAllMocks())

	it("invalidates the upload success queries after duplication", async () => {
		vi.spyOn(apiClient.artifacts, "duplicate").mockResolvedValue({
			artifact: { ...baseArtifact, id: "a2", title: "Spec (copy)", currentRevisionId: "r2" },
			revision: { id: "r2", artifactId: "a2", seq: 1, status: "approved" } as never,
		})
		const { queryClient } = renderHarness()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		fireEvent.click(screen.getByRole("button", { name: "Duplicate" }))

		await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(4))
		expect(invalidateQueries.mock.calls.map(([options]) => options)).toEqual([
			{ queryKey: QueryKeys.approvals.pending() },
			{ queryKey: QueryKeys.artifacts.get("a2") },
			{ queryKey: QueryKeys.revisions.list("a2") },
			{ queryKey: ["artifacts", "list"] },
		])
	})

	it("duplicates an html artifact through the server-side endpoint, not revisions.text", async () => {
		const text = vi.spyOn(apiClient.revisions, "text")
		const duplicate = vi.spyOn(apiClient.artifacts, "duplicate").mockResolvedValue({
			artifact: { ...baseArtifact, id: "a2", title: "Spec (copy)", currentRevisionId: null },
			revision: { id: "r2", artifactId: "a2", seq: 1, status: "approved" } as never,
		})
		renderHarness({ ...baseArtifact, kind: "html" })
		fireEvent.click(screen.getByRole("button", { name: "Duplicate" }))
		await waitFor(() => expect(duplicate).toHaveBeenCalledWith({ artifactId: "a1" }))
		expect(text).not.toHaveBeenCalled()
		expect(await screen.findByText('Duplicated — "Spec (copy)" is live.')).toBeInTheDocument()
	})

	it("toasts Pending when the copy's first revision waits for approval", async () => {
		vi.spyOn(apiClient.artifacts, "duplicate").mockResolvedValue({
			artifact: { ...baseArtifact, id: "a2", title: "Spec (copy)", currentRevisionId: null },
			revision: { id: "r2", artifactId: "a2", seq: 1, status: "pending" } as never,
		})
		renderHarness()
		fireEvent.click(screen.getByRole("button", { name: "Duplicate" }))
		expect(await screen.findByText('Duplicated — "Spec (copy)" is waiting under Pending.')).toBeInTheDocument()
	})

	it("toasts the server's error message when duplication fails", async () => {
		vi.spyOn(apiClient.artifacts, "duplicate").mockRejectedValue(new Error("Could not duplicate this file"))
		renderHarness()
		fireEvent.click(screen.getByRole("button", { name: "Duplicate" }))
		expect(await screen.findByText("Could not duplicate this file")).toBeInTheDocument()
	})
})

describe("useArtifactActions copy link", () => {
	afterEach(() => vi.restoreAllMocks())

	it("copies the Artifact's one address and toasts who it opens for", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
		renderHarness()
		fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/artifacts/a1`)
		expect(await screen.findByText("Link copied — opens only for people this file is shared with.")).toBeInTheDocument()
	})

	it("toasts when the clipboard refuses", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("denied"))
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
		renderHarness()
		fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
		expect(await screen.findByText("Could not copy the link")).toBeInTheDocument()
	})
})
