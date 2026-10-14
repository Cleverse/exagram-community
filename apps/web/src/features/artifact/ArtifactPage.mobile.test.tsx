import { ApiError, type PendingRevision, type Project, type VisibleArtifact } from "@exagram/api-client"
import { type QueryClient } from "@tanstack/react-query"
import { fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ArtifactPageMobile from "./ArtifactPage.mobile"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { clearSentRequests, recordSent } from "@/features/access-requests/sentRequests"
import { decision, feedOf } from "@/test/accessRequests"
import { renderMobile } from "@/test/mobile"

const project = (id: string, name: string): Project => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId: null,
	publishPolicy: "manual",
	linkPreview: "metadata",
	name,
	createdAt: new Date(2026, 0, 1),
})

const artifact = (over: Partial<VisibleArtifact> = {}): VisibleArtifact => ({
	id: "a1",
	workspaceId: "w1",
	ownerId: "u1",
	projectId: "p1",
	kind: "doc",
	title: "Q4 board pack",
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "manual",
	deletedAt: null,
	createdAt: new Date(2026, 0, 1),
	visibleRevisionId: "r3",
	access: "owner",
	isPinned: false,
	revisionSeq: 3,
	updatedAt: new Date(),
	ownerName: "Ada Lovelace",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "northwind.example",
	...over,
})

const pending = (over: Partial<PendingRevision> = {}): PendingRevision => ({
	placeholderTypes: [],
	redactionStatus: "done",
	revisionId: "rev4",
	artifactId: "a1",
	seq: 4,
	authorUserId: "u2",
	authorConnectionId: null,
	mime: "text/markdown",
	bytes: 10,
	note: null,
	createdAt: new Date(),
	title: "Q4 board pack",
	kind: "doc",
	ownerId: "u1",
	isApprover: true,
	authorName: "Grace Hopper",
	authorConnectionName: null,
	...over,
})

const renderReading = (
	file: VisibleArtifact,
	{ queue = [], more }: { queue?: PendingRevision[]; more?: (client: QueryClient) => void } = {},
) =>
	renderMobile(<ArtifactPageMobile />, {
		path: "/artifacts/:artifactId",
		at: `/artifacts/${file.id}`,
		seed: (client) => {
			client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [file])
			client.setQueryData(QueryKeys.artifacts.get(file.id), file)
			client.setQueryData(QueryKeys.projects.list(), [project("p1", "Q4")])
			client.setQueryData(QueryKeys.approvals.pending(), queue)
			client.setQueryData(QueryKeys.revisions.text(file.id, file.visibleRevisionId), {
				revisionId: file.visibleRevisionId,
				mime: "text/markdown",
				text: "## Summary\n\nRevenue grew.",
			})
			more?.(client)
		},
	})

const sheetParams = async (kind: string): Promise<unknown> =>
	JSON.parse(
		within(await screen.findByRole("dialog", { name: kind })).getByTestId("sheet-params").textContent ?? "",
	) as unknown

describe("ArtifactPage on a phone", () => {
	beforeEach(() => {
		window.localStorage.clear()
		clearSentRequests()
	})
	afterEach(() => vi.restoreAllMocks())

	it("heads the file with its name over its folder, and reads its document", () => {
		renderReading(artifact())
		const title = screen.getByRole("heading", { level: 1, name: "Q4 board pack" })
		expect(within(title).getByRole("button", { name: "Q4 board pack" })).toHaveAccessibleDescription("Q4")
		expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument()
		expect(screen.getByText("Revenue grew.")).toBeInTheDocument()
		// Chat is gone from mobile web (v1.5).
		expect(screen.queryByRole("button", { name: /Ask about this/ })).not.toBeInTheDocument()
	})

	it("keeps the header to one fixed row, so only the document scrolls (v1.5)", async () => {
		renderReading(artifact())
		const title = await screen.findByRole("heading", { level: 1 })
		// MobileScreen's scrolling body is the one `overflow-y-auto` element; the header sits outside it.
		expect(title.closest(".overflow-y-auto")).toBeNull()
		// No bottom toolbar: History, Pin and Details are in the More drawer.
		for (const name of ["History", "Pin", "Details"])
			expect(screen.queryByRole("button", { name })).not.toBeInTheDocument()
	})

	it("goes up to the file's Project on Back, even opened cold from a link", async () => {
		const user = userEvent.setup()
		renderReading(artifact())
		await user.click(screen.getByRole("button", { name: "Back" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/projects/p1")
	})

	it("goes up to All artifacts for a file in no Project", async () => {
		const user = userEvent.setup()
		renderReading(artifact({ projectId: null }))
		await user.click(screen.getByRole("button", { name: "Back" }))
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/)
	})

	it("opens File actions, Share and Details as drawers", async () => {
		const user = userEvent.setup()
		renderReading(artifact())

		await user.click(screen.getByRole("button", { name: "More actions" }))
		expect(await sheetParams("file")).toEqual({ artifactId: "a1" })
		await user.click(screen.getByRole("button", { name: "Close" }))

		await user.click(screen.getByRole("button", { name: "Share" }))
		expect(await sheetParams("share")).toEqual({ target: { kind: "artifact", id: "a1" } })
		await user.click(screen.getByRole("button", { name: "Close" }))

		// Tapping the file's name opens Details.
		await user.click(screen.getByRole("button", { name: "Q4 board pack" }))
		expect(await sheetParams("details")).toEqual({ artifactId: "a1" })
	})

	it("asks the Owner to approve a waiting version, and approves it", async () => {
		const user = userEvent.setup()
		const approve = vi.spyOn(apiClient.approvals, "approve").mockResolvedValue(undefined as never)
		renderReading(artifact(), { queue: [pending()] })
		const banner = screen.getByRole("status")
		expect(banner).toHaveTextContent("v4 from Grace is waiting for your approval. Connections still read v3.")
		await user.click(within(banner).getByRole("button", { name: "Approve" }))
		expect(approve).toHaveBeenCalledWith({ revisionId: "rev4", confirmPlaceholders: false })
		expect(await screen.findByText("v4 of Q4 board pack is now the published version.")).toBeInTheDocument()
	})

	it("rejects a waiting version, keeping its author's copy", async () => {
		const user = userEvent.setup()
		const discard = vi.spyOn(apiClient.approvals, "discard").mockResolvedValue(undefined as never)
		renderReading(artifact(), { queue: [pending()] })
		await user.click(within(screen.getByRole("status")).getByRole("button", { name: "Reject" }))
		expect(discard).toHaveBeenCalledWith({ revisionId: "rev4" })
		expect(await screen.findByText("v4 rejected — its author keeps a copy in their drafts.")).toBeInTheDocument()
	})

	it("asks once more before approving a Connection's placeholders", async () => {
		const user = userEvent.setup()
		const approve = vi.spyOn(apiClient.approvals, "approve").mockResolvedValue(undefined as never)
		renderReading(artifact(), {
			queue: [pending({ authorConnectionId: "c1", authorConnectionName: "Claude Code", placeholderTypes: ["EMAIL"] })],
		})
		expect(screen.getByText("Sensitive values will become placeholders: [EMAIL].")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Approve" }))
		expect(approve).not.toHaveBeenCalled()
		await user.click(await screen.findByRole("button", { name: "Approve anyway" }))
		expect(approve).toHaveBeenCalledWith({ revisionId: "rev4", confirmPlaceholders: true })
	})

	it("shows a reader their own draft waiting for the Owner, with nothing to decide", () => {
		renderReading(artifact({ access: "edit", ownerId: "u2" }), {
			queue: [pending({ authorUserId: "u1", ownerId: "u2", isApprover: false })],
		})
		expect(screen.getByRole("status")).toHaveTextContent("v4 is waiting for the Owner. Connections still read v3.")
		expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
	})

	it("offers no decision to the file's owner when the server says someone else approves it", () => {
		// An Author's own file inside another person's folder: access is "owner", but the folder's owner approves.
		renderReading(artifact({ access: "owner", ownerId: "u1" }), {
			queue: [pending({ authorUserId: "u1", ownerId: "u1", isApprover: false })],
		})
		expect(screen.getByRole("status")).toHaveTextContent("v4 is waiting for the Owner. Connections still read v3.")
		expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
	})

	it("sets a table's rows as cards", () => {
		const file = artifact()
		renderReading(file, {
			more: (client) =>
				client.setQueryData(QueryKeys.revisions.text(file.id, file.visibleRevisionId), {
					revisionId: file.visibleRevisionId,
					mime: "text/markdown",
					text: "| Tier | Price |\n| --- | --- |\n| Team | $29 |",
				}),
		})
		expect(screen.queryByRole("table")).not.toBeInTheDocument()
		expect(screen.getByText("Price").nextSibling).toHaveTextContent("$29")
	})

	it("leaves a document room to scroll its end clear of the toolbar", () => {
		renderReading(artifact())
		const body = screen.getByText("Revenue grew.").closest(".overflow-y-auto")
		expect(body?.lastElementChild).toHaveStyle({ height: "env(safe-area-inset-bottom)" })
	})

	it("reads a deck as slide cards", () => {
		const file = artifact({ kind: "pptx" })
		renderReading(file, {
			more: (client) =>
				client.setQueryData(QueryKeys.revisions.text(file.id, file.visibleRevisionId), {
					revisionId: file.visibleRevisionId,
					mime: "text/plain",
					text: "<!-- Slide: 1 -->\nQ4 at a glance\nRevenue up 12%\n<!-- Slide: 2 -->\nNext steps",
				}),
		})
		const first = screen.getByRole("listitem", { name: "Slide 1" })
		expect(first).toHaveTextContent("Q4 at a glance")
		expect(first).toHaveTextContent("Revenue up 12%")
		expect(screen.getByRole("listitem", { name: "Slide 2" })).toHaveTextContent("Next steps")
	})

	it("frames HTML in the sandboxed usercontent frame", () => {
		const file = artifact({ kind: "html" })
		renderReading(file, {
			more: (client) =>
				client.setQueryData(QueryKeys.revisions.bodyToken(file.id, file.visibleRevisionId), {
					revisionId: file.visibleRevisionId,
					url: "about:blank#r3",
				}),
		})
		const frame = screen.getByTitle("Contents of Q4 board pack")
		expect(frame).toHaveAttribute("src", "about:blank#r3")
		expect(frame).toHaveAttribute("sandbox", "allow-scripts")
		// Edge to edge: the frame sits straight in the scrolling body, with no card around it, and fills it.
		const wrapper = frame.parentElement
		expect(wrapper).toHaveClass("relative", "flex-1")
		expect(wrapper?.parentElement).toHaveClass("overflow-y-auto")
		expect(wrapper?.parentElement).toHaveStyle({ display: "flex", flexDirection: "column" })
		expect(frame).toHaveClass("flex-1")
		// …and runs to the bottom of the screen: no toolbar spacer after it.
		expect(wrapper?.nextElementSibling).toBeNull()
		expect(screen.getByText("Loading preview…")).toBeInTheDocument()

		fireEvent.load(frame)
		expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument()
		expect(frame.nextElementSibling).toBeNull()
	})

	it.each(["load", "error"] as const)("shows a skeleton above an image until it fires %s", (event) => {
		const file = artifact({ kind: "image", title: "Floor plan" })
		renderReading(file, {
			more: (client) =>
				client.setQueryData(QueryKeys.revisions.bodyToken(file.id, file.visibleRevisionId), {
					revisionId: file.visibleRevisionId,
					url: "about:blank#img",
				}),
		})
		const image = screen.getByRole("img", { name: "Floor plan" })
		expect(screen.getByText("Loading preview…")).toBeInTheDocument()

		fireEvent[event](image)
		expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument()
	})

	it("opens an org file by id when the library does not list it", async () => {
		const file = artifact({ access: "view", generalAccess: "org", orgDomain: "northwind.example" })
		const get = vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(file)
		renderMobile(<ArtifactPageMobile />, {
			path: "/artifacts/:artifactId",
			at: "/artifacts/a1",
			seed: (client) => {
				client.setQueryData(QueryKeys.revisions.text(file.id, file.visibleRevisionId), {
					revisionId: file.visibleRevisionId,
					mime: "text/markdown",
					text: "## Private by link",
				})
			},
		})
		expect(await screen.findByRole("heading", { name: "Private by link" })).toBeInTheDocument()
		expect(get).toHaveBeenCalledWith({ artifactId: "a1" })
	})

	it("offers Request access, naming nothing, when the file can't be opened", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(404, "File not found"))
		renderMobile(<ArtifactPageMobile />, { path: "/artifacts/:artifactId", at: "/artifacts/gone" })
		expect(await screen.findByRole("heading", { name: "You need access" })).toBeInTheDocument()
		expect(screen.getByText("Ask the owner for access to this file.")).toBeInTheDocument()
	})

	it("opens a file this phone asked for behind the Owner's approval, then reads it", async () => {
		recordSent("u1.w1", "a1", { at: Date.now() - 3_600_000, role: "view", note: "" })
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(artifact({ access: "view", projectId: null }))
		vi.spyOn(apiClient.notifications, "list").mockResolvedValue(
			feedOf([
				decision({ artifactId: "a1", outcome: "granted", title: "Q4 board pack", actorName: "Ada", role: "view" }),
			]),
		)
		renderMobile(<ArtifactPageMobile />, {
			path: "/artifacts/:artifactId",
			at: "/artifacts/a1",
			seed: (client) => {
				client.setQueryData(QueryKeys.revisions.text("a1", "r3"), {
					revisionId: "r3",
					mime: "text/markdown",
					text: "## Approved body",
				})
			},
		})
		expect(await screen.findByRole("heading", { name: "You now have access to “Q4 board pack”" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "Approved body" })).not.toBeInTheDocument()
		await userEvent.setup().click(screen.getByRole("button", { name: "Open" }))
		expect(await screen.findByRole("heading", { name: "Approved body" })).toBeInTheDocument()
	})

	it("asks for the password of a file open to Anyone with the link, then reads it", async () => {
		const file = artifact({ access: "view", generalAccess: "anyone", orgDomain: null })
		vi.spyOn(apiClient.artifacts, "get")
			.mockRejectedValueOnce(new ApiError(403, "File not found", "PASSWORD_REQUIRED"))
			.mockResolvedValue(file)
		const unlock = vi.spyOn(apiClient.artifacts, "unlock").mockResolvedValue(undefined)
		renderMobile(<ArtifactPageMobile />, {
			path: "/artifacts/:artifactId",
			at: "/artifacts/a1",
			seed: (client) => {
				client.setQueryData(QueryKeys.revisions.text(file.id, file.visibleRevisionId), {
					revisionId: file.visibleRevisionId,
					mime: "text/markdown",
					text: "## Behind the lock",
				})
			},
		})
		expect(await screen.findByRole("heading", { name: "Enter password to open" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "You need access" })).not.toBeInTheDocument()

		await userEvent.setup().type(screen.getByLabelText("Password"), "right-one{Enter}")
		expect(await screen.findByRole("heading", { name: "Behind the lock" })).toBeInTheDocument()
		expect(unlock).toHaveBeenCalledWith({ artifactId: "a1", password: "right-one" })
	})

	it("says the link has expired rather than that the file is missing", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(410, "File not found", "ANYONE_EXPIRED"))
		renderMobile(<ArtifactPageMobile />, { path: "/artifacts/:artifactId", at: "/artifacts/a1" })
		expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "You need access" })).not.toBeInTheDocument()
	})
})
