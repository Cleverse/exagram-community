import {
	type AccessRequest,
	type PendingRevision,
	type Project,
	type VisibleArtifact,
	type WorkspaceKind,
} from "@exagram/api-client"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ActivityScreenMobile from "./ActivityScreen.mobile"
import { markSeen } from "./lastSeen"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { stateScopeOf } from "@/features/workspace/stateScope"
import { WorkspaceScope } from "@/features/workspace/WorkspaceScope"
import { ME, renderMobile } from "@/test/mobile"
import { sessionIn } from "@/test/workspaces"

const HOUR = 3_600_000
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR)
const pinClockToMidday = () => vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 15, 12, 0) })

const project = (id: string, name: string, parentProjectId: string | null = null): Project => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId,
	publishPolicy: "manual",
	linkPreview: "metadata",
	name,
	createdAt: new Date(2026, 0, 1),
})

const artifact = (over: Partial<VisibleArtifact>): VisibleArtifact => ({
	id: "a1",
	workspaceId: "w1",
	ownerId: "u1",
	projectId: "p1",
	kind: "doc",
	title: "Spec",
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "manual",
	deletedAt: null,
	createdAt: new Date(2026, 0, 1),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 3,
	updatedAt: hoursAgo(72),
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

const pending = (over: Partial<PendingRevision>): PendingRevision => ({
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
	createdAt: hoursAgo(80),
	title: "Spec",
	kind: "doc",
	ownerId: "u1",
	isApprover: true,
	authorName: "Grace Hopper",
	authorConnectionName: null,
	...over,
})

const theirs = (over: Partial<VisibleArtifact>) =>
	artifact({ ownerId: "u2", ownerName: "Grace Hopper", access: "view", ...over })

const renderActivity = (
	data: { artifacts: VisibleArtifact[]; pending?: PendingRevision[]; projects?: Project[]; requests?: AccessRequest[] },
	at = "/activity",
	kind: WorkspaceKind = "team",
) =>
	renderMobile(<ActivityScreenMobile />, {
		path: "/activity",
		at,
		seed: (client) => {
			client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn(kind, "w1") })
			client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), data.artifacts)
			client.setQueryData(QueryKeys.projects.list(), data.projects ?? [project("p1", "Q4")])
			client.setQueryData(QueryKeys.approvals.pending(), data.pending ?? [])
			client.setQueryData(QueryKeys.accessRequests.list(), data.requests ?? [])
		},
	})

describe("ActivityScreen on a phone", () => {
	beforeEach(() => markSeen(stateScopeOf(ME), 0))
	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	describe("when the session switches Workspace", () => {
		const ARRIVING = "00000000-0000-4000-8000-0000000000b2"
		const readLineOf = (workspaceId: string) =>
			window.localStorage.getItem(`exagram.activity.lastSeen.${stateScopeOf({ id: ME.id, workspaceId })}`)

		const switchFrom = async (at: string) => {
			window.localStorage.removeItem(`exagram.activity.lastSeen.${stateScopeOf({ id: ME.id, workspaceId: ARRIVING })}`)
			const { client } = renderMobile(
				<WorkspaceScope>
					<Routes>
						<Route path="/activity" element={<ActivityScreenMobile />} />
						<Route path="*" element={<div>a file page</div>} />
					</Routes>
				</WorkspaceScope>,
				{ path: "*", at },
			)
			await act(async () => {
				client.setQueryData(QueryKeys.auth.me(), { ...ME, workspaceId: ARRIVING })
				await new Promise((resolve) => setTimeout(resolve, 100))
			})
			await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/activity"))
		}

		it("reads neither Workspace when it leaves a page that is not Activity, which nobody looked at on the way", async () => {
			await switchFrom("/artifacts/a1")

			expect(Number(readLineOf(ME.workspaceId))).toBe(0)
			expect(readLineOf(ARRIVING)).toBeNull()
		})

		it("reads the Workspace it leaves when that was Activity, which was looked at, and not the one it arrives in", async () => {
			await switchFrom("/activity")

			expect(Number(readLineOf(ME.workspaceId))).toBeGreaterThan(0)
			expect(readLineOf(ARRIVING)).toBeNull()
		})
	})

	it("opens an unlisted legacy preview id on its artifact page", async () => {
		renderActivity({ artifacts: [] }, "/activity?preview=org-file")
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/org-file"))
	})

	it("shows this person's events by default and everyone's under Team, in the address as desktop", async () => {
		const user = userEvent.setup()
		renderActivity({
			artifacts: [artifact({ id: "a1", title: "Mine" }), theirs({ id: "a2", title: "Theirs" })],
		})
		expect(screen.getByRole("radio", { name: "Mine 1" })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("link", { name: /You published v3 of Mine/ })).toBeInTheDocument()
		expect(screen.queryByText("Theirs")).not.toBeInTheDocument()

		await user.click(screen.getByRole("radio", { name: "Team 2" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/activity?scope=team")
		expect(screen.getByRole("link", { name: /Grace published v3 of Theirs/ })).toHaveAttribute("href", "/artifacts/a2")
	})

	it("has no Mine / Team choice in a Personal Workspace, and shows everyone's events on its files", () => {
		renderActivity(
			{ artifacts: [artifact({ id: "a1", title: "Mine" }), theirs({ id: "a2", title: "Theirs", access: "edit" })] },
			"/activity",
			"personal",
		)
		expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
		expect(screen.queryByRole("radio", { name: /Team/ })).not.toBeInTheDocument()
		expect(screen.getByRole("link", { name: /You published v3 of Mine/ })).toBeInTheDocument()
		expect(screen.getByRole("link", { name: /Grace published v3 of Theirs/ })).toBeInTheDocument()
	})

	it("groups the feed by day, and says uploaded for a first version", () => {
		pinClockToMidday()
		renderActivity(
			{
				artifacts: [
					theirs({ id: "a1", title: "Brief", revisionSeq: 1, updatedAt: hoursAgo(0.5) }),
					theirs({ id: "a2", title: "Pricing", updatedAt: hoursAgo(100) }),
				],
			},
			"/activity?scope=team",
		)
		const today = screen.getByRole("region", { name: "Today" })
		expect(within(today).getByRole("link", { name: /Grace uploaded Brief/ })).toBeInTheDocument()
		expect(within(today).queryByText("Pricing")).not.toBeInTheDocument()
		expect(screen.getByRole("link", { name: /Grace published v3 of Pricing/ })).toBeInTheDocument()
	})

	it("tints a file in no Project, and names a folder's place", () => {
		renderActivity({
			projects: [project("p1", "Q4"), project("p2", "Pricing", "p1")],
			artifacts: [
				artifact({ id: "a1", title: "Loose", projectId: null }),
				artifact({ id: "a2", title: "Filed", projectId: "p2" }),
			],
		})
		expect(within(screen.getByRole("link", { name: /Loose/ })).getByText("No folder")).toBeInTheDocument()
		expect(within(screen.getByRole("link", { name: /Filed/ })).getByText("Q4 › Pricing")).toBeInTheDocument()
	})

	it("lists what waits on this person, and approves it with desktop's toast", async () => {
		const user = userEvent.setup()
		const approve = vi.spyOn(apiClient.approvals, "approve").mockResolvedValue(undefined as never)
		renderActivity({
			artifacts: [artifact({})],
			pending: [
				pending({}),
				pending({ revisionId: "rev9", ownerId: "u3", isApprover: false, title: "Not mine to approve" }),
			],
		})
		const needs = screen.getByRole("region", { name: "Needs your action" })
		expect(within(needs).getAllByRole("listitem")).toHaveLength(1)
		expect(within(needs).getByText(/v4 from Grace/)).toBeInTheDocument()

		await user.click(within(needs).getByRole("button", { name: "Approve" }))
		expect(approve).toHaveBeenCalledWith({ revisionId: "rev4", confirmPlaceholders: false })
		expect(await screen.findByText("v4 of Spec is now the published version.")).toBeInTheDocument()
	})

	it("lists the open Access Requests on this person's files, and grants one at the picked role", async () => {
		const user = userEvent.setup()
		const grant = vi.spyOn(apiClient.accessRequests, "grant").mockResolvedValue(undefined as never)
		vi.spyOn(apiClient.accessRequests, "list").mockResolvedValue([])
		renderActivity({
			artifacts: [artifact({})],
			requests: [
				{
					id: "q1",
					artifactId: "a1",
					artifactTitle: "Spec",
					requesterId: "u3",
					requesterEmail: "grace@example.com",
					requesterName: "Grace Hopper",
					role: "view",
					note: "For the Q3 review",
					createdAt: new Date(2026, 0, 1),
				},
			],
		})
		const region = screen.getByRole("region", { name: "Access requests" })
		expect(region).toHaveTextContent("Grace Hopper (grace@example.com) asked for access to Spec")
		await user.selectOptions(within(region).getByRole("combobox", { name: "Role for Grace Hopper" }), "collaborate")
		await user.click(within(region).getByRole("button", { name: "Grant" }))
		expect(grant).toHaveBeenCalledWith({ id: "q1", role: "collaborate" })
	})

	it("opens a waiting Revision's preview drawer from Preview", async () => {
		const user = userEvent.setup()
		renderActivity({ artifacts: [artifact({})], pending: [pending({})] })
		await user.click(screen.getByRole("button", { name: "Preview" }))
		const drawer = await screen.findByRole("dialog", { name: "pendingPreview" })
		expect(within(drawer).getByTestId("sheet-params")).toHaveTextContent(JSON.stringify({ revisionId: "rev4" }))
	})

	it("rejects a waiting Revision, keeping the author's copy", async () => {
		const user = userEvent.setup()
		const discard = vi.spyOn(apiClient.approvals, "discard").mockResolvedValue(undefined as never)
		renderActivity({ artifacts: [artifact({})], pending: [pending({})] })
		await user.click(screen.getByRole("button", { name: "Reject" }))
		expect(discard).toHaveBeenCalledWith({ revisionId: "rev4" })
		expect(await screen.findByText("v4 rejected — its author keeps a copy in their drafts.")).toBeInTheDocument()
	})

	it("holds Approve while a Connection's Revision is still being checked", () => {
		renderActivity({
			artifacts: [artifact({})],
			pending: [pending({ authorConnectionId: "c1", authorConnectionName: "Claude Code", redactionStatus: "queued" })],
		})
		expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
	})

	it("marks others' updates from the last day unread until Mark all read", async () => {
		const user = userEvent.setup()
		renderActivity(
			{
				artifacts: [
					theirs({ id: "a1", title: "Fresh", updatedAt: hoursAgo(1) }),
					theirs({ id: "a2", title: "Old", updatedAt: hoursAgo(50) }),
					artifact({ id: "a3", title: "Own", updatedAt: hoursAgo(1) }),
				],
			},
			"/activity?scope=team",
		)
		expect(within(screen.getByRole("link", { name: /Fresh/ })).getByLabelText("Unread")).toBeInTheDocument()
		expect(within(screen.getByRole("link", { name: /Old/ })).queryByLabelText("Unread")).not.toBeInTheDocument()
		expect(within(screen.getByRole("link", { name: /Own/ })).queryByLabelText("Unread")).not.toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Mark all read" }))
		expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument()
	})

	it("keeps rows unread while open, and reads them once the screen is left", () => {
		const data = { artifacts: [theirs({ title: "Fresh", updatedAt: hoursAgo(1) })] }
		const first = renderActivity(data, "/activity?scope=team")
		expect(screen.getByLabelText("Unread")).toBeInTheDocument()
		first.unmount()

		renderActivity(data, "/activity?scope=team")
		expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument()
	})

	it("points to Team when this person has done nothing yet", () => {
		renderActivity({ artifacts: [theirs({})] })
		expect(screen.getByText("Nothing of yours yet — Team shows 1 event.")).toBeInTheDocument()
	})
})
