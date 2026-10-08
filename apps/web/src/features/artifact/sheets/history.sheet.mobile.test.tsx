import { type VisibleArtifact } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { artifactFixture, renderSheet, revisionFixture } from "./sheetHarness"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const load = () => import("./history.sheet.mobile")

const open = (artifact: VisibleArtifact = artifactFixture()) =>
	renderSheet("history", { artifactId: artifact.id }, load, {
		seed: (client) => {
			client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [artifact])
			client.setQueryData(QueryKeys.revisions.list(artifact.id), [
				revisionFixture(1, { note: "first upload" }),
				revisionFixture(2, { note: "tightened the intro", status: "discarded" }),
				revisionFixture(3, { note: "board edits" }),
				revisionFixture(4, { note: "late numbers", status: "pending", authorUserId: "u9" }),
			])
		},
	})

afterEach(() => vi.restoreAllMocks())

describe("History drawer", () => {
	it("lists every revision newest first with its badge, author and note", async () => {
		open()
		const dialog = await screen.findByRole("dialog", { name: "Version history" })
		const rows = within(dialog).getAllByRole("listitem")
		expect(rows.map((row) => within(row).getByRole("button").textContent?.slice(0, 2))).toEqual([
			"v4",
			"v3",
			"v2",
			"v1",
		])
		expect(rows[0]).toHaveTextContent("a collaborator")
		expect(rows[0]).toHaveTextContent("Pending")
		expect(rows[1]).toHaveTextContent("Current")
		expect(rows[1]).toHaveTextContent("board edits")
		expect(rows[2]).toHaveTextContent("Discarded")
	})

	it("offers Restore only on an older approved revision, which writes a new revision with desktop's toast", async () => {
		const user = userEvent.setup()
		const restore = vi
			.spyOn(apiClient.revisions, "restoreAsNew")
			.mockResolvedValue(revisionFixture(5, { status: "pending" }) as never)
		open()
		const dialog = await screen.findByRole("dialog", { name: "Version history" })

		await user.click(within(dialog).getByRole("button", { name: /^v3/ }))
		expect(within(dialog).queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument()
		await user.click(within(dialog).getByRole("button", { name: /^v2/ }))
		expect(within(dialog).queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument()

		await user.click(within(dialog).getByRole("button", { name: /^v1/ }))
		await user.click(within(dialog).getByRole("button", { name: "Restore v1" }))
		await waitFor(() => expect(restore).toHaveBeenCalledWith({ artifactId: "a1", revisionId: "r1" }))
		expect(await screen.findByRole("status")).toHaveTextContent("Restored v1 as v5, waiting for approval.")
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("tells a non-Owner that history is the Owner's", async () => {
		const list = vi.spyOn(apiClient.revisions, "list")
		open(artifactFixture({ access: "edit" }))
		expect(await screen.findByRole("dialog", { name: "Version history" })).toHaveTextContent(
			"Only the file's owner can see its history.",
		)
		expect(list).not.toHaveBeenCalled()
	})
})
