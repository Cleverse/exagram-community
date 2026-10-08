import { type PendingRevision } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { renderSheet } from "@/features/artifact/sheets/sheetHarness"

const load = () => import("./pendingPreview.sheet.mobile")

const pending = (over: Partial<PendingRevision> = {}): PendingRevision => ({
	placeholderTypes: [],
	redactionStatus: "done",
	revisionId: "rev4",
	artifactId: "a1",
	seq: 4,
	authorUserId: "u2",
	authorConnectionId: null,
	mime: "text/html",
	bytes: 10,
	note: null,
	createdAt: new Date("2026-09-20T00:00:00Z"),
	title: "Board pack",
	kind: "html",
	ownerId: "u1",
	isApprover: true,
	authorName: "Grace Hopper",
	authorConnectionName: null,
	...over,
})

const open = (revisions: PendingRevision[]) =>
	renderSheet("pendingPreview", { revisionId: "rev4" }, load, {
		seed: (client) => client.setQueryData(QueryKeys.approvals.pending(), revisions),
	})

afterEach(() => vi.restoreAllMocks())

describe("Pending preview drawer", () => {
	it("frames a pending HTML page from its named body token, with Approve for the Owner", async () => {
		const user = userEvent.setup()
		const token = vi
			.spyOn(apiClient.revisions, "bodyTokenAt")
			.mockResolvedValue({ revisionId: "rev4", url: "about:blank#t4", expiresInSeconds: 300 })
		const approve = vi.spyOn(apiClient.approvals, "approve").mockResolvedValue(undefined as never)
		open([pending()])
		const drawer = await screen.findByRole("dialog", { name: "v4 · Pending" })
		const frame = await within(drawer).findByTitle("Contents of Board pack v4")
		expect(frame).toHaveAttribute("src", "about:blank#t4")
		expect(frame).toHaveAttribute("sandbox", "allow-scripts")
		expect(token).toHaveBeenCalledWith({ artifactId: "a1", revisionId: "rev4" })

		await user.click(within(drawer).getByRole("button", { name: "Approve" }))
		expect(approve).toHaveBeenCalledWith({ revisionId: "rev4", confirmPlaceholders: false })
		// Deciding closes the drawer, as desktop's dialog closes; the toast outlives it.
		expect(await screen.findByText("v4 of Board pack is now the published version.")).toBeInTheDocument()
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "v4 · Pending" })).not.toBeInTheDocument())
	})

	it("closes once a Reject succeeds", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.revisions, "revisionText").mockResolvedValue({
			revisionId: "rev4",
			mime: "text/markdown",
			text: "x",
		})
		const discard = vi.spyOn(apiClient.approvals, "discard").mockResolvedValue(undefined as never)
		open([pending({ kind: "doc", mime: "text/markdown" })])
		const drawer = await screen.findByRole("dialog", { name: "v4 · Pending" })
		await user.click(within(drawer).getByRole("button", { name: "Reject" }))
		expect(discard).toHaveBeenCalledWith({ revisionId: "rev4" })
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "v4 · Pending" })).not.toBeInTheDocument())
	})

	it("shows the author their own draft's text with no decision", async () => {
		vi.spyOn(apiClient.revisions, "revisionText").mockResolvedValue({
			revisionId: "rev4",
			mime: "text/markdown",
			text: "my late numbers",
		})
		open([pending({ kind: "doc", mime: "text/markdown", ownerId: "u9", authorUserId: "u1", isApprover: false })])
		const drawer = await screen.findByRole("dialog", { name: "v4 · Pending" })
		expect(await within(drawer).findByText(/my late numbers/)).toBeInTheDocument()
		expect(within(drawer).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
	})

	it("says so once the Revision is no longer waiting", async () => {
		open([])
		expect(await screen.findByText("This version is no longer waiting for approval.")).toBeInTheDocument()
	})
})
