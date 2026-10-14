import { type Revision, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest"

import { HistoryDialog } from "./HistoryDialog"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const artifact: VisibleArtifact = {
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
	visibleRevisionId: "r2",
	currentRevisionId: "r2",
	access: "owner",
	isPinned: false,
	revisionSeq: 2,
	updatedAt: new Date("2026-09-14T00:00:00Z"),
	ownerName: "Ada",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "northwind.example",
}

const revision = (id: string, seq: number, status: Revision["status"], note: string | null): Revision => ({
	id,
	artifactId: "a1",
	seq,
	status,
	authorUserId: "u1",
	authorConnectionId: null,
	storageKey: `k${seq}`,
	mime: "text/markdown",
	bytes: 10,
	sha256: "x",
	note,
	extractedText: null,
	extractionStatus: "done",
	createdAt: new Date("2026-09-10T00:00:00Z"),
	approvedAt: null,
})

const TEXTS: Record<string, string> = {
	r1: "# Spec\nold line\nsame",
	r2: "# Spec\nnew line\nsame",
	r3: "# Spec\nnumbers",
}

const renderDialog = (
	subject: VisibleArtifact = artifact,
	extra: Revision[] = [],
	props: { onClose?: () => void; onDownloadCurrent?: () => void } = {},
) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.revisions.list("a1"), [
		revision("r1", 1, "approved", "First upload"),
		revision("r2", 2, "approved", "Tightened the summary"),
		revision("r3", 3, "pending", "Added numbers"),
		...extra,
	])
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<HistoryDialog
					artifact={subject}
					onClose={props.onClose ?? vi.fn()}
					onDownloadCurrent={props.onDownloadCurrent ?? vi.fn()}
				/>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

const card = (note: RegExp) => screen.getByRole("button", { name: note })

let readText: MockInstance<typeof apiClient.revisions.revisionText>

beforeEach(() => {
	readText = vi
		.spyOn(apiClient.revisions, "revisionText")
		.mockImplementation(({ revisionId }) =>
			Promise.resolve({ revisionId, mime: "text/markdown", text: TEXTS[revisionId] ?? "" }),
		)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("HistoryDialog", () => {
	it("lists every revision newest first, tagging the pending one and the current one", () => {
		renderDialog()
		const dialog = screen.getByRole("dialog", { name: "Revision history" })
		const list = within(dialog).getByRole("list", { name: "3 revisions" })
		const items = within(list).getAllByRole("listitem")
		expect(items.map((item) => item.textContent?.slice(0, 2))).toEqual(["v3", "v2", "v1"])
		expect(items[0]).toHaveTextContent("Pending")
		expect(items[1]).toHaveTextContent("Current")
	})

	it("selects the current revision on open and previews its text", async () => {
		renderDialog()
		expect(card(/Tightened the summary/)).toHaveAttribute("aria-pressed", "true")
		expect(screen.getByText("Current version")).toBeInTheDocument()
		expect(await screen.findByText(/new line/)).toBeInTheDocument()
		expect(readText).toHaveBeenCalledWith({ artifactId: "a1", revisionId: "r2" })
		expect(screen.getByRole("button", { name: "Download v2" })).toBeEnabled()
		expect(screen.queryByRole("button", { name: /^Restore/ })).not.toBeInTheDocument()
	})

	it("offers no Download when the Owner turned it off for readers of the link", () => {
		renderDialog({ ...artifact, canDownload: false })
		expect(screen.queryByRole("button", { name: /^Download/ })).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
	})

	it("selects a card on click without toggling it off, and previews that revision", async () => {
		const user = userEvent.setup()
		renderDialog()

		await user.click(card(/First upload/))
		await user.click(card(/First upload/))
		expect(card(/First upload/)).toHaveAttribute("aria-pressed", "true")
		expect(card(/Tightened the summary/)).toHaveAttribute("aria-pressed", "false")
		expect(screen.getByText("Viewing an older version")).toBeInTheDocument()
		expect(await screen.findByText(/old line/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Restore v1" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Download v1" })).toBeInTheDocument()
	})

	it("restores through the restore endpoint", async () => {
		const user = userEvent.setup()
		const restore = vi.spyOn(apiClient.revisions, "restoreAsNew").mockResolvedValue(revision("r4", 4, "pending", null))
		renderDialog()

		await user.click(card(/First upload/))
		await user.click(screen.getByRole("button", { name: "Restore v1" }))
		expect(restore).toHaveBeenCalledWith({ artifactId: "a1", revisionId: "r1" })
		expect(await screen.findByRole("status")).toHaveTextContent("Restored v1 as v4, waiting for approval.")
	})

	it("says a restore is current at once when the server published it, as a Personal Workspace does", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.revisions, "restoreAsNew").mockResolvedValue(revision("r4", 4, "approved", null))
		renderDialog()

		await user.click(card(/First upload/))
		await user.click(screen.getByRole("button", { name: "Restore v1" }))
		expect(await screen.findByRole("status")).toHaveTextContent(/^Restored v1 as v4\.$/)
	})

	it("downloads the selected revision's own text for a Markdown file", async () => {
		const user = userEvent.setup()
		const createObjectURL = vi.fn(() => "blob:v1")
		Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
		const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
		renderDialog()

		await user.click(card(/First upload/))
		await user.click(screen.getByRole("button", { name: "Download v1" }))
		expect(readText).toHaveBeenCalledWith({ artifactId: "a1", revisionId: "r1" })
		expect(createObjectURL).toHaveBeenCalled()
		expect(click).toHaveBeenCalled()
	})

	it("hands the current revision of a binary kind to the pane's own Download, and disables older ones", async () => {
		const user = userEvent.setup()
		const onDownloadCurrent = vi.fn()
		renderDialog({ ...artifact, kind: "pdf" }, [], { onDownloadCurrent })

		await user.click(screen.getByRole("button", { name: "Download v2" }))
		expect(onDownloadCurrent).toHaveBeenCalledOnce()

		await user.click(card(/First upload/))
		const older = screen.getByRole("button", { name: "Download v1" })
		expect(older).toBeDisabled()
		expect(older).toHaveAttribute("title", "Only the version Connections read now can be downloaded for this file type")
	})

	it("compares a revision's text with the current one, and Escape closes only the comparison", async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		renderDialog(artifact, [], { onClose })

		await user.click(card(/First upload/))
		await user.click(screen.getByRole("button", { name: "Compare with current" }))

		const compare = await screen.findByRole("dialog", { name: "Compare v1 with v2" })
		const diff = await within(compare).findByRole("list", { name: "Compare v1 with v2" })
		expect(within(diff).getByText("removed:").parentElement).toHaveTextContent("old line")
		expect(within(diff).getByText("added:").parentElement).toHaveTextContent("new line")
		expect(within(compare).getByText("1 added · 1 removed · v2 is current")).toBeInTheDocument()

		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog", { name: "Compare v1 with v2" })).not.toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "Revision history" })).toBeInTheDocument()
		expect(onClose).not.toHaveBeenCalled()

		await user.keyboard("{Escape}")
		expect(onClose).toHaveBeenCalledOnce()
	})

	it("never offers Restore for a pending or discarded revision, but still compares them", async () => {
		const user = userEvent.setup()
		renderDialog(artifact, [revision("r4", 4, "discarded", "Dropped draft")])

		await user.click(card(/Added numbers/))
		expect(screen.getByText("Pending approval")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /^Restore/ })).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Compare with current" })).toBeInTheDocument()

		await user.click(card(/Dropped draft/))
		expect(screen.queryByRole("button", { name: /^Restore/ })).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Compare with current" })).toBeInTheDocument()
	})

	it("offers no Compare for an HTML page and frames an older one from its own named token", async () => {
		const user = userEvent.setup()
		const namedToken = vi
			.spyOn(apiClient.revisions, "bodyTokenAt")
			.mockImplementation(({ revisionId }) =>
				Promise.resolve({ revisionId, url: `about:blank#${revisionId}`, expiresInSeconds: 300 }),
			)
		vi.spyOn(apiClient.revisions, "bodyToken").mockResolvedValue({
			revisionId: "r2",
			url: "about:blank#r2",
			expiresInSeconds: 300,
		})
		renderDialog({ ...artifact, kind: "html" })
		await user.click(card(/First upload/))
		expect(screen.getByRole("button", { name: "Restore v1" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Compare with current" })).not.toBeInTheDocument()
		const frame = await screen.findByTitle("Contents of Spec v1")
		expect(frame).toHaveAttribute("src", "about:blank#r1")
		expect(frame).toHaveAttribute("sandbox", "allow-scripts")
		expect(namedToken).toHaveBeenCalledWith({ artifactId: "a1", revisionId: "r1" })
		expect(readText).not.toHaveBeenCalled()
	})

	it("says calmly that an office file's preview isn't ready when its text is not extracted", async () => {
		readText.mockRejectedValue(new Error("Text extraction is unavailable for this Revision."))
		renderDialog({ ...artifact, kind: "pdf" })
		expect(await screen.findByText("A preview isn't ready for this file yet.")).toBeInTheDocument()
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
	})

	it("still alerts with the server's message when a text file's read fails", async () => {
		readText.mockRejectedValue(new Error("This file is unavailable."))
		renderDialog()
		expect(await screen.findByRole("alert")).toHaveTextContent("This file is unavailable.")
	})
})
