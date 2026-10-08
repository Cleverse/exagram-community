import { type Project, type VisibleArtifact } from "@exagram/api-client"
import { type QueryClient } from "@tanstack/react-query"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useSheet } from "@/components/mobile/sheet/context"
import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { type SheetKind, type SheetParams } from "@/components/mobile/sheet/types"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { clearMock, readMock } from "@/mock/store"
import { ME, recordingSheets, renderMobile } from "@/test/mobile"
import { sessionIn } from "@/test/workspaces"

const project = (id: string, name: string): Project => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	name,
	parentProjectId: null,
	publishPolicy: "auto",
	linkPreview: "metadata",
	createdAt: new Date(2026, 0, 1),
})

const artifact = (over: Partial<VisibleArtifact>): VisibleArtifact => ({
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
	...over,
})

/** The recording drawers, with the real ones for the kinds this lane builds. */
const withRealSheets = () => {
	const sheets: Map<SheetKind, SheetLoader> = recordingSheets()
	sheets.set("new", () => import("./new.sheet.mobile") as never)
	sheets.set("newProject", () => import("./newProject.sheet.mobile") as never)
	sheets.set("search", () => import("./search.sheet.mobile") as never)
	return sheets
}

const Opener = <K extends SheetKind>({ kind, params }: { kind: K; params: SheetParams[K] }) => {
	const sheet = useSheet()
	return (
		<button type="button" onClick={() => sheet.open(kind, params)}>
			Open
		</button>
	)
}

const openSheet = async <K extends SheetKind>(
	kind: K,
	params: SheetParams[K],
	{ seed, at = "/" }: { seed?: (client: QueryClient) => void; at?: string } = {},
) => {
	const user = userEvent.setup()
	const rendered = renderMobile(<Opener kind={kind} params={params} />, {
		path: "*",
		at,
		seed,
		sheets: withRealSheets(),
	})
	await user.click(screen.getByRole("button", { name: "Open" }))
	return { user, ...rendered }
}

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe("Create drawer", () => {
	it("uploads the picked files into the Project it was opened for, then closes", async () => {
		const upload = vi.spyOn(apiClient.artifacts, "create").mockRejectedValue(new Error("offline"))
		await openSheet("new", { projectId: "p1" })
		await screen.findByRole("dialog", { name: "Create" })

		const file = new File(["# Notes"], "notes.md", { type: "text/markdown" })
		fireEvent.change(screen.getByLabelText("Choose files to upload"), { target: { files: [file] } })

		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(await screen.findByRole("status")).toHaveTextContent(/notes\.md/)
		await waitFor(() => expect(upload).toHaveBeenCalled())
		expect(upload.mock.calls[0]?.[0]).toMatchObject({ projectId: "p1" })
	})

	it("steps into New project with Back, nested under the Project it was opened for", async () => {
		const { user } = await openSheet("new", { projectId: "p1" })
		await user.click(await screen.findByRole("button", { name: /New project/ }))
		expect(await screen.findByRole("dialog", { name: "New project" })).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Back" }))
		expect(await screen.findByRole("dialog", { name: "Create" })).toBeInTheDocument()
	})
})

describe("New project drawer", () => {
	afterEach(() => clearMock("project.p9"))

	it("creates the Project with its publishing choice and policy, then opens it", async () => {
		const create = vi.spyOn(apiClient.projects, "create").mockResolvedValue(project("p9", "Q4 planning"))
		const setPolicy = vi.spyOn(apiClient.projects, "setPublishPolicy").mockResolvedValue(undefined as never)
		const { user } = await openSheet("newProject", { parentId: "p1" })
		await screen.findByRole("dialog", { name: "New project" })

		const submit = screen.getByRole("button", { name: "Create project" })
		expect(submit).toBeDisabled()
		await user.type(screen.getByLabelText("Name"), "  Q4 planning ")
		await user.type(screen.getByLabelText("Policy for AI clients"), "Cite every claim.")
		await user.click(screen.getByRole("radio", { name: /Manual approval only/ }))
		await user.click(submit)

		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/projects/p9"))
		expect(create.mock.calls[0]?.[0]).toEqual({ name: "Q4 planning", parentProjectId: "p1" })
		expect(setPolicy.mock.calls[0]?.[0]).toEqual({ projectId: "p9", publishPolicy: "manual" })
		expect(readMock("project.p9", null)).toEqual({ policy: "Cite every claim.", overwrite: false })
		expect(screen.getByRole("status")).toHaveTextContent(
			"Q4 planning created — manual approval only, private until you invite someone.",
		)
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("offers no Publishing choice in a Personal Workspace, and does not report one", async () => {
		const create = vi.spyOn(apiClient.projects, "create").mockResolvedValue(project("p9", "Notes"))
		const setPolicy = vi.spyOn(apiClient.projects, "setPublishPolicy")
		const { user } = await openSheet(
			"newProject",
			{ parentId: null },
			{
				seed: (client) => {
					client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn("personal", "w1") })
				},
			},
		)
		await screen.findByRole("dialog", { name: "New project" })
		expect(screen.queryByText("Publishing")).not.toBeInTheDocument()
		expect(screen.queryByRole("radio", { name: /Manual approval only/ })).not.toBeInTheDocument()

		await user.type(screen.getByLabelText("Name"), "Notes")
		await user.click(screen.getByRole("button", { name: "Create project" }))
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/projects/p9"))
		expect(create).toHaveBeenCalledTimes(1)
		expect(setPolicy).not.toHaveBeenCalled()
		expect(screen.getByRole("status")).toHaveTextContent(/^Notes created\.$/)
	})

	it("keeps the server's default policy without a second call, and says when creating fails", async () => {
		const create = vi.spyOn(apiClient.projects, "create").mockRejectedValueOnce(new Error("Name taken"))
		const setPolicy = vi.spyOn(apiClient.projects, "setPublishPolicy")
		const { user } = await openSheet("newProject", { parentId: null })
		await user.type(await screen.findByLabelText("Name"), "Q4")
		await user.click(screen.getByRole("button", { name: "Create project" }))

		expect(await screen.findByRole("status")).toHaveTextContent("Name taken")
		expect(screen.getByRole("dialog", { name: "New project" })).toBeInTheDocument()

		create.mockResolvedValueOnce(project("p9", "Q4"))
		await user.click(screen.getByRole("button", { name: "Create project" }))
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/projects/p9"))
		expect(setPolicy).not.toHaveBeenCalled()
	})
})

describe("Search drawer", () => {
	const seed = (client: QueryClient) => {
		client.setQueryData(QueryKeys.projects.list(), [project("p1", "Q4 Sales")])
		client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [
			artifact({ id: "a1", title: "Board pack", projectId: "p1" }),
			artifact({ id: "a2", title: "Pricing sheet" }),
		])
	}

	it("focuses its field once the drawer has risen, and lists recent files", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		await openSheet("search", {}, { seed })
		const field = await screen.findByRole("searchbox", { name: "Search projects and files" })
		expect(field).not.toHaveFocus()
		await act(() => vi.advanceTimersByTimeAsync(260))
		expect(field).toHaveFocus()
		expect(screen.getByText("Recent")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: /Board pack/ })).toHaveAttribute("href", "/artifacts/a1")
	})

	it("shows matching Projects and files, and a file's More steps into its File drawer", async () => {
		vi.spyOn(apiClient.artifacts, "search").mockResolvedValue([{ artifactId: "a1" }] as never)
		const { user } = await openSheet("search", {}, { seed })
		await user.type(await screen.findByRole("searchbox"), "q4")

		expect(await screen.findByText("2 results")).toBeInTheDocument()
		const dialog = screen.getByRole("dialog", { name: "Search" })
		expect(within(dialog).getByRole("link", { name: /^Q4 Sales/ })).toHaveAttribute("href", "/projects/p1")
		await user.click(within(dialog).getByRole("button", { name: "More actions for Board pack" }))
		expect(await screen.findByRole("dialog", { name: "file" })).toHaveTextContent('{"artifactId":"a1"}')
		expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument()
	})

	it("says when nothing matches", async () => {
		vi.spyOn(apiClient.artifacts, "search").mockResolvedValue([])
		const { user } = await openSheet("search", {}, { seed })
		await user.type(await screen.findByRole("searchbox"), "zebra")
		expect(await screen.findByText("No projects or files match that.")).toBeInTheDocument()
	})

	it("closes when a result is opened", async () => {
		const { user } = await openSheet("search", {}, { seed })
		await user.click(await screen.findByRole("link", { name: /Pricing sheet/ }))
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a2")
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})
})
