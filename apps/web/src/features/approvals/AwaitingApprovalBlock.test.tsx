import { type PendingRevision, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AwaitingApprovalBlock, AwaitingApprovalBlockView } from "./AwaitingApprovalBlock"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const baseRevision = {
	revisionId: "r1",
	artifactId: "a1",
	title: "Spec",
	kind: "doc" as const,
	currentRev: "v3",
	seq: 4,
	nextRev: "v4",
	note: "v4 waiting · from Grace · Connections still read v3",
	isOwner: true,
}

const renderBlock = (
	revisions: Parameters<typeof AwaitingApprovalBlockView>[0]["revisions"],
	overrides: Partial<{ onApprove: (id: string) => void; onReject: (id: string) => void; busy: boolean }> = {},
) =>
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<MemoryRouter>
				<AwaitingApprovalBlockView
					revisions={revisions}
					busy={overrides.busy ?? false}
					onApprove={overrides.onApprove ?? vi.fn()}
					onReject={overrides.onReject ?? vi.fn()}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	)

afterEach(() => {
	vi.restoreAllMocks()
})

describe("AwaitingApprovalBlockView", () => {
	it("renders nothing for an empty list", () => {
		const { container } = renderBlock([])
		expect(container).toBeEmptyDOMElement()
	})

	it("renders the count, the revision step and Reject/Approve for the Owner", () => {
		renderBlock([baseRevision])
		expect(screen.getByText(/Awaiting approval · 1/)).toBeInTheDocument()
		expect(screen.getByText("v4")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument()
	})

	it("names the uploader and the revision Connections keep reading", () => {
		renderBlock([baseRevision])
		expect(screen.getByText(/v4 waiting · from Grace · Connections still read v3/)).toBeInTheDocument()
	})

	it("shows 'Waiting for the Owner' for a non-owner", () => {
		renderBlock([{ ...baseRevision, isOwner: false }])
		expect(screen.getByText("Waiting for the Owner")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
	})

	it("offers Preview to the Owner and to anyone else who sees the row", () => {
		const { unmount } = renderBlock([baseRevision])
		expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument()
		unmount()
		renderBlock([{ ...baseRevision, isOwner: false }])
		expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument()
	})

	it("previews a pending HTML page in the sandboxed frame from its named body token", async () => {
		const token = vi
			.spyOn(apiClient.revisions, "bodyTokenAt")
			.mockResolvedValue({ revisionId: "r1", url: "about:blank#t1", expiresInSeconds: 300 })
		renderBlock([{ ...baseRevision, kind: "html" }])
		await userEvent.click(screen.getByRole("button", { name: "Preview" }))
		const dialog = screen.getByRole("dialog", { name: "Spec · v4 · Pending" })
		const frame = await within(dialog).findByTitle("Contents of Spec v4")
		expect(frame).toHaveAttribute("src", "about:blank#t1")
		expect(frame).toHaveAttribute("sandbox", "allow-scripts")
		expect(frame).toHaveAttribute("referrerPolicy", "no-referrer")
		expect(token).toHaveBeenCalledWith({ artifactId: "a1", revisionId: "r1" })
	})

	it("previews a pending doc's text, and approving from the preview decides the row", async () => {
		vi.spyOn(apiClient.revisions, "revisionText").mockResolvedValue({
			revisionId: "r1",
			mime: "text/markdown",
			text: "# Spec\nthe pending draft",
		})
		const onApprove = vi.fn()
		renderBlock([baseRevision], { onApprove })
		await userEvent.click(screen.getByRole("button", { name: "Preview" }))
		const dialog = screen.getByRole("dialog", { name: "Spec · v4 · Pending" })
		expect(await within(dialog).findByText(/the pending draft/)).toBeInTheDocument()
		await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }))
		expect(onApprove).toHaveBeenCalledWith("r1")
		expect(screen.queryByRole("dialog", { name: "Spec · v4 · Pending" })).not.toBeInTheDocument()
	})

	it("gives a non-owner's preview no decision, and keeps Approve blocked while a Connection Revision is checked", async () => {
		vi.spyOn(apiClient.revisions, "revisionText").mockResolvedValue({
			revisionId: "r1",
			mime: "text/markdown",
			text: "x",
		})
		const { unmount } = renderBlock([{ ...baseRevision, isOwner: false }])
		await userEvent.click(screen.getByRole("button", { name: "Preview" }))
		const dialog = screen.getByRole("dialog", { name: "Spec · v4 · Pending" })
		expect(within(dialog).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
		// The header's × and the footer's Close both close it.
		await userEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!)
		expect(screen.queryByRole("dialog", { name: "Spec · v4 · Pending" })).not.toBeInTheDocument()
		unmount()

		renderBlock([
			{ ...baseRevision, authorConnectionId: "connection-1", placeholderTypes: [], redactionStatus: "queued" },
		])
		await userEvent.click(screen.getByRole("button", { name: "Preview" }))
		const checking = screen.getByRole("dialog", { name: "Spec · v4 · Pending" })
		expect(within(checking).getByRole("button", { name: "Approve" })).toBeDisabled()
		expect(within(checking).getByRole("button", { name: "Reject" })).toBeEnabled()
	})

	it("calls onApprove with the revisionId when Approve is clicked", async () => {
		const onApprove = vi.fn()
		renderBlock([baseRevision], { onApprove })
		await userEvent.click(screen.getByRole("button", { name: "Approve" }))
		expect(onApprove).toHaveBeenCalledWith("r1")
	})

	it("calls onReject with the revisionId when Reject is clicked", async () => {
		const onReject = vi.fn()
		renderBlock([baseRevision], { onReject })
		await userEvent.click(screen.getByRole("button", { name: "Reject" }))
		expect(onReject).toHaveBeenCalledWith("r1")
	})

	it("requires a second confirmation for placeholders from a Connection", async () => {
		const onApprove = vi.fn()
		const connectionRevision = {
			...baseRevision,
			authorConnectionId: "connection-1",
			placeholderTypes: ["EMAIL", "PHONE"] as ("EMAIL" | "PHONE")[],
			redactionStatus: "done" as const,
		}
		const ControlledBlock = () => {
			const [confirmationRevisionId, setConfirmationRevisionId] = useState<string | null>(null)

			return (
				<MemoryRouter>
					<AwaitingApprovalBlockView
						revisions={[connectionRevision]}
						busy={false}
						onApprove={(revisionId) => setConfirmationRevisionId(revisionId)}
						onReject={vi.fn()}
						confirmationRevisionId={confirmationRevisionId}
						onConfirm={() => {
							setConfirmationRevisionId(null)
							onApprove("r1", true)
						}}
						onCancelConfirmation={() => setConfirmationRevisionId(null)}
					/>
				</MemoryRouter>
			)
		}
		render(<ControlledBlock />)

		await userEvent.click(screen.getByRole("button", { name: "Approve" }))
		expect(onApprove).not.toHaveBeenCalled()
		expect(screen.getByRole("dialog", { name: "Confirm placeholders" })).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Approve anyway" }))
		expect(onApprove).toHaveBeenCalledWith("r1", true)
	})

	it("keeps Approval unavailable until a Connection Revision is checked", () => {
		renderBlock([
			{
				...baseRevision,
				authorConnectionId: "connection-1",
				placeholderTypes: [],
				redactionStatus: "queued",
			},
		])
		expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
	})
})

describe("AwaitingApprovalBlock", () => {
	const artifact = { id: "a1", revisionSeq: 1, title: "Spec" } as VisibleArtifact
	const pending = (over: Partial<PendingRevision>): PendingRevision => ({
		placeholderTypes: [],
		redactionStatus: "done",
		revisionId: "r2",
		artifactId: "a1",
		seq: 2,
		authorUserId: "u1",
		authorConnectionId: null,
		mime: "text/markdown",
		bytes: 10,
		note: null,
		createdAt: new Date(),
		title: "Spec",
		kind: "doc",
		ownerId: "u1",
		isApprover: true,
		authorName: "Ada Lovelace",
		authorConnectionName: null,
		...over,
	})

	const renderFor = (revision: PendingRevision, subject: VisibleArtifact = artifact) => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1" })
		queryClient.setQueryData(QueryKeys.approvals.pending(), [revision])
		return render(
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<MemoryRouter>
						<AwaitingApprovalBlock artifacts={[subject]} heading={false} />
					</MemoryRouter>
				</ToastProvider>
			</QueryClientProvider>,
		)
	}

	it("calls the Owner's own upload theirs, not a collaborator's", () => {
		renderFor(pending({}))
		expect(screen.getByText(/v2 waiting · your upload · Connections still read v1/)).toBeInTheDocument()
		expect(screen.queryByText(/collaborator/)).not.toBeInTheDocument()
	})

	it("names another person and a Connection by its name, and shows the author's note", () => {
		const { unmount } = renderFor(pending({ authorUserId: "u2", authorName: "Grace Hopper", note: "Fixed totals" }))
		expect(screen.getByText(/v2 waiting · from Grace · Fixed totals/)).toBeInTheDocument()
		unmount()

		renderFor(pending({ authorConnectionId: "c1", authorConnectionName: "Claude Code" }))
		expect(screen.getByText(/v2 waiting · from Claude Code/)).toBeInTheDocument()
	})

	it("says a first upload is not published yet, and shows its step without an arrow", () => {
		renderFor(pending({ seq: 1 }), { ...artifact, revisionSeq: null })
		expect(screen.getByText(/v1 waiting · your upload · not published yet/)).toBeInTheDocument()
		expect(screen.queryByText(/→/)).not.toBeInTheDocument()
	})
})
