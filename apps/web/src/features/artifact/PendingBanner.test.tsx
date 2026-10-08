import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PendingBannerView } from "./PendingBanner"

import { apiClient } from "@/config/apiClient"

const pending = {
	revisionId: "r1",
	artifactId: "a1",
	title: "Spec",
	kind: "doc" as const,
	seq: 2,
	note: "tightened the intro",
}
const connectionPending = {
	...pending,
	authorConnectionId: "connection-1",
	placeholderTypes: ["EMAIL" as const],
	redactionStatus: "done" as const,
}

const ControlledPendingBanner = ({
	onApprove,
}: {
	onApprove: (revisionId: string, confirmPlaceholders?: boolean) => void
}) => {
	const [confirmationRevisionId, setConfirmationRevisionId] = useState<string | null>(null)

	return (
		<PendingBannerView
			pending={connectionPending}
			isOwner
			onApprove={(revisionId) => setConfirmationRevisionId(revisionId)}
			onDiscard={vi.fn()}
			busy={false}
			confirmationRevisionId={confirmationRevisionId}
			onConfirm={() => {
				setConfirmationRevisionId(null)
				onApprove("r1", true)
			}}
			onCancelConfirmation={() => setConfirmationRevisionId(null)}
		/>
	)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("PendingBannerView", () => {
	it("renders nothing when there is no pending revision for this artifact", () => {
		const { container } = render(
			<PendingBannerView pending={null} isOwner onApprove={vi.fn()} onDiscard={vi.fn()} busy={false} />,
		)
		expect(container).toBeEmptyDOMElement()
	})

	it("offers Approve and Discard to the owner", async () => {
		const onApprove = vi.fn()
		const onDiscard = vi.fn()
		render(<PendingBannerView pending={pending} isOwner onApprove={onApprove} onDiscard={onDiscard} busy={false} />)
		expect(screen.getByText(/v2 is Pending/)).toBeInTheDocument()
		expect(screen.getByText(/tightened the intro/)).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Approve" }))
		await userEvent.click(screen.getByRole("button", { name: "Discard" }))
		expect(onApprove).toHaveBeenCalledWith("r1")
		expect(onDiscard).toHaveBeenCalledWith("r1")
	})

	it("tells a non-owner it is waiting, with Preview as its only button", () => {
		render(<PendingBannerView pending={pending} isOwner={false} onApprove={vi.fn()} onDiscard={vi.fn()} busy={false} />)
		expect(screen.getByText(/waiting for the Owner/)).toBeInTheDocument()
		expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Preview"])
	})

	it("previews the pending text, and Discard from the preview discards it", async () => {
		vi.spyOn(apiClient.revisions, "revisionText").mockResolvedValue({
			revisionId: "r1",
			mime: "text/markdown",
			text: "the tightened intro",
		})
		const onDiscard = vi.fn()
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<PendingBannerView pending={pending} isOwner onApprove={vi.fn()} onDiscard={onDiscard} busy={false} />
			</QueryClientProvider>,
		)
		await userEvent.click(screen.getByRole("button", { name: "Preview" }))
		const dialog = screen.getByRole("dialog", { name: "Spec · v2 · Pending" })
		expect(await within(dialog).findByText(/the tightened intro/)).toBeInTheDocument()
		await userEvent.click(within(dialog).getByRole("button", { name: "Discard" }))
		expect(onDiscard).toHaveBeenCalledWith("r1")
	})

	it("disables both buttons while a decision is in flight", () => {
		render(<PendingBannerView pending={pending} isOwner onApprove={vi.fn()} onDiscard={vi.fn()} busy />)
		for (const name of ["Approve", "Discard"]) {
			expect(screen.getByRole("button", { name })).toBeDisabled()
		}
	})

	it("requires confirmation before approving Connection placeholders", async () => {
		const onApprove = vi.fn()
		render(<ControlledPendingBanner onApprove={onApprove} />)

		await userEvent.click(screen.getByRole("button", { name: "Approve" }))
		expect(onApprove).not.toHaveBeenCalled()
		expect(screen.getByRole("dialog", { name: "Confirm placeholders" })).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(onApprove).not.toHaveBeenCalled()
		await userEvent.click(screen.getByRole("button", { name: "Approve" }))
		await userEvent.click(screen.getByRole("button", { name: "Approve anyway" }))
		expect(onApprove).toHaveBeenCalledWith("r1", true)
	})

	it.each(["none", "queued"] as const)("holds Approve while the Connection Revision is %s", (redactionStatus) => {
		render(
			<PendingBannerView
				pending={{ ...connectionPending, placeholderTypes: [], redactionStatus }}
				isOwner
				onApprove={vi.fn()}
				onDiscard={vi.fn()}
				busy={false}
			/>,
		)
		expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled()
	})

	it.each([
		["failed", "The check for sensitive values failed and will be retried."],
		["too_large", "Too large to check for sensitive values, so it cannot be approved. Discard it."],
	] as const)("shows the %s Connection redaction status", (redactionStatus, message) => {
		render(
			<PendingBannerView
				pending={{ ...connectionPending, placeholderTypes: [], redactionStatus }}
				isOwner
				onApprove={vi.fn()}
				onDiscard={vi.fn()}
				busy={false}
			/>,
		)
		expect(screen.getByText(message)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled()
	})
})
