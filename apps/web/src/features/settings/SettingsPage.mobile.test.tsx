import { type ActivityEntry, ApiError } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	LATER_PREFERENCES,
	me,
	MEMBERS,
	renderSettings,
	stubSettingsApi,
	useCommunityTeam,
} from "./SettingsPage.mobile.harness"

import { apiClient } from "@/config/apiClient"
import { edition } from "@/edition/edition"
import { RESET_LINK_REFUSED } from "@/features/settings/hooks/useResetLinks"
import { asCommunityInvites } from "@/test/edition"
import { ME } from "@/test/mobile"

const entry = (callId: string, minutesAgo: number, over: Partial<ActivityEntry> = {}): ActivityEntry => ({
	callId,
	principalKind: "connection",
	principalId: "settings-conn-1",
	surface: "mcp",
	action: "artifact_read",
	status: "delivered",
	startedAt: new Date(Date.now() - minutesAgo * 60_000),
	deliveredAt: null,
	artifactId: null,
	revisionId: null,
	outcome: "served",
	reason: null,
	actor: { userId: "u2", name: "Grace Hopper", email: "grace@example.com" },
	subject: null,
	...over,
})

beforeEach(() => {
	stubSettingsApi()
	useCommunityTeam()
})

afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
})

describe("SettingsPage (mobile)", () => {
	it("heads every tab with Settings and the Workspace, and tabs General, Team, Audit, Notifications", () => {
		renderSettings("general", { redaction: { redaction: "on", canChange: true, enabled: false } })
		expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument()
		const tabs = within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("link")
		expect(tabs.map((link) => link.textContent)).toEqual(["General", "Team", "Audit", "Notifications"])
		expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page")
	})

	it("tabs only General and Notifications in a Personal Workspace, named as the library", () => {
		renderSettings("general", { workspaceKind: "personal" })
		expect(screen.getByText("Personal library")).toBeInTheDocument()
		const tabs = within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("link")
		expect(tabs.map((link) => link.textContent)).toEqual(["General", "Notifications"])
		expect(screen.queryByRole("radiogroup", { name: "Edition" })).not.toBeInTheDocument()
	})

	it("sends /settings/audit to General in a Personal Workspace", () => {
		renderSettings("audit", { workspaceKind: "personal" })
		expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page")
	})

	it("moves between tabs by address", async () => {
		const user = userEvent.setup()
		renderSettings("general")
		await user.click(screen.getByRole("link", { name: "Team" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/team")
		expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument()
	})

	it("lists the members on Team, each with their role", async () => {
		renderSettings("team")
		expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument()
		expect(screen.getByText("2 members · 1 admin")).toBeInTheDocument()
		expect(screen.getByText("Ada Lovelace").parentElement).toHaveTextContent("Owner")
		expect(screen.getByText("Grace Hopper").parentElement).toHaveTextContent("Member")
	})

	it("lists the Workspace Owner first on Team, then you, then everyone else by name", async () => {
		vi.spyOn(apiClient.workspace, "listMembers").mockResolvedValue({
			view: "member",
			items: [
				{ ...MEMBERS[1]!, name: "Abe Able" },
				{ ...MEMBERS[1]!, id: ME.id, name: "Yan You", role: "admin" },
				{ ...MEMBERS[0]!, name: "Zoe Owner" },
			],
		})
		renderSettings("team")
		await screen.findByText("Zoe Owner")
		expect(screen.getAllByText(/^(Abe Able|Yan You|Zoe Owner)$/).map((name) => name.textContent)).toEqual([
			"Zoe Owner",
			"Yan You",
			"Abe Able",
		])
	})

	it("lets an Admin create a Join Link on Team, and hides Invites from everyone else", async () => {
		const user = userEvent.setup()
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
		const url = `https://app.example.test/join/${"J".repeat(43)}`
		const create = vi.spyOn(apiClient.workspace, "createInvite").mockResolvedValue({
			invite: {
				id: "00000000-0000-4000-8000-0000000000a1",
				email: "new@example.com",
				role: "member",
				via: "admin_invite",
				invitedByName: "Ada",
				createdAt: new Date(),
				expiresAt: new Date(Date.now() + 86_400_000),
			},
			url,
			emailQueued: false,
		})
		const { unmount } = renderSettings("team")
		expect(await screen.findByText("No pending invites.")).toBeInTheDocument()
		await user.type(screen.getByLabelText("Email"), "new@example.com")
		await user.click(screen.getByRole("button", { name: "Create invite link" }))
		expect(create).toHaveBeenCalledWith({ email: "new@example.com", role: "member" })
		expect(await screen.findByText(url)).toBeInTheDocument()
		expect(writeText).toHaveBeenCalledWith(url)
		unmount()

		vi.spyOn(apiClient.workspace, "listMembers").mockResolvedValue({ view: "member", items: MEMBERS })
		renderSettings("team", { isAdmin: false })
		expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument()
		expect(screen.queryByText("Invites")).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Create invite link" })).not.toBeInTheDocument()
	})

	it("leaves the Role out of the Invites block where Invites grant Member only", async () => {
		asCommunityInvites()
		renderSettings("team")
		expect(await screen.findByLabelText("Email")).toBeInTheDocument()
		expect(screen.queryByLabelText("Role")).not.toBeInTheDocument()
	})

	it("lets an Admin create a reset link on General where the install allows it, and only there", async () => {
		const user = userEvent.setup()
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
		const url = `https://app.example.test/reset/${"R".repeat(43)}`
		const create = vi
			.spyOn(apiClient.workspace, "createResetLink")
			.mockResolvedValue({ url, expiresAt: new Date(Date.now() + 3_600_000) })
		const list = vi.spyOn(apiClient.workspace, "listInvites")
		const { unmount } = renderSettings("general")
		await waitFor(() => expect(list).toHaveBeenCalled())
		await screen.findByText("Account")
		expect(screen.queryByRole("button", { name: "Create reset link" })).not.toBeInTheDocument()
		unmount()

		vi.spyOn(apiClient.workspace, "listInvites").mockResolvedValue({ items: [], passwordReset: true })
		renderSettings("general")
		await user.type(await screen.findByLabelText("Member's email"), "member@example.com")
		await user.click(screen.getByRole("button", { name: "Create reset link" }))
		expect(create).toHaveBeenCalledWith({ email: "member@example.com" })
		expect(await screen.findByText(url)).toBeInTheDocument()
		expect(screen.getByText(/works once, for 1 hour/)).toBeInTheDocument()
		expect(writeText).toHaveBeenCalledWith(url)
	})

	it("explains a refused reset link instead of the server's refusal text, and keeps any other error's message", async () => {
		vi.spyOn(apiClient.workspace, "listInvites").mockResolvedValue({ items: [], passwordReset: true })
		vi.spyOn(apiClient.workspace, "createResetLink")
			.mockRejectedValueOnce(new ApiError(404, "Could not create a reset link"))
			.mockRejectedValueOnce(new ApiError(429, "Too many requests."))
		const user = userEvent.setup()
		renderSettings("general")

		await user.type(await screen.findByLabelText("Member's email"), "admin@example.com")
		await user.click(screen.getByRole("button", { name: "Create reset link" }))
		expect(await screen.findByText(RESET_LINK_REFUSED)).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Create reset link" }))
		expect(await screen.findByText("Too many requests.")).toBeInTheDocument()
		expect(screen.queryByText(RESET_LINK_REFUSED)).not.toBeInTheDocument()
	})

	it("explains a refused invite as an Admin-only action", async () => {
		vi.spyOn(apiClient.workspace, "createInvite").mockRejectedValue(new ApiError(404, "Could not create the invite"))
		const user = userEvent.setup()
		renderSettings("team")

		await user.type(await screen.findByLabelText("Email"), "new@example.com")
		await user.click(screen.getByRole("button", { name: "Create invite link" }))
		expect(await screen.findByText(edition.copy.inviteRefused)).toBeInTheDocument()
	})

	it("shows the four notification switches to every member, and saves one as it moves", async () => {
		let saved = { ...LATER_PREFERENCES, accessRequests: true, pendingRevisions: false, grants: true, comments: true }
		const read = vi.spyOn(apiClient.notifications, "getPreferences").mockImplementation(() => Promise.resolve(saved))
		const set = vi.spyOn(apiClient.notifications, "setPreferences").mockImplementation((prefs) => {
			saved = prefs
			return Promise.resolve(prefs)
		})
		const user = userEvent.setup()
		renderSettings("notifications", { isAdmin: false })

		expect(screen.getByText(/appear in the Exagram apps for Mac and iPhone/)).toBeInTheDocument()
		const app = within(screen.getByRole("region", { name: "Notify me when" }))
		const approvals = await app.findByRole("switch", { name: /Approvals/ })
		expect(approvals).toHaveAttribute("aria-checked", "false")
		expect(app.getAllByRole("switch")).toHaveLength(4)

		await user.click(approvals)
		expect(app.getByRole("switch", { name: /Approvals/ })).toHaveAttribute("aria-checked", "true")
		expect(set).toHaveBeenCalledWith({
			...LATER_PREFERENCES,
			accessRequests: true,
			pendingRevisions: true,
			grants: true,
			comments: true,
		})
		// The read-back after the save, before the spies are restored.
		await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
	})

	it("leaves Approvals out of the app switches in a Personal Workspace, and saves it unchanged", async () => {
		let saved = { ...LATER_PREFERENCES, accessRequests: true, pendingRevisions: true, grants: false, comments: true }
		vi.spyOn(apiClient.notifications, "getPreferences").mockImplementation(() => Promise.resolve(saved))
		const set = vi.spyOn(apiClient.notifications, "setPreferences").mockImplementation((prefs) => {
			saved = prefs
			return Promise.resolve(prefs)
		})
		const user = userEvent.setup()
		renderSettings("notifications", { isAdmin: false, workspaceKind: "personal" })

		const app = within(screen.getByRole("region", { name: "Notify me when" }))
		expect(await app.findByRole("switch", { name: /Shared with you/ })).toBeInTheDocument()
		expect(app.getAllByRole("switch")).toHaveLength(3)
		expect(app.queryByRole("switch", { name: /Approvals/ })).not.toBeInTheDocument()

		await user.click(app.getByRole("switch", { name: /Shared with you/ }))
		expect(set).toHaveBeenCalledWith({
			...LATER_PREFERENCES,
			accessRequests: true,
			pendingRevisions: true,
			grants: true,
			comments: true,
		})
	})

	it("answers a tab it does not have with not found", () => {
		renderSettings("billing")
		expect(screen.getByRole("alert")).toHaveTextContent("This page isn't available")
	})

	it("shows the account on General", () => {
		renderSettings("general")
		expect(screen.getByText("ada@example.com")).toBeInTheDocument()
		expect(screen.getByText("Not connected")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Connect Google" })).toHaveAttribute(
			"href",
			expect.stringContaining("/v1/auth/google/start?mode=link"),
		)
	})

	it("signs out from General", async () => {
		const user = userEvent.setup()
		const signOut = vi.spyOn(apiClient.auth, "signOut").mockResolvedValue(undefined as never)
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(me as never)
		renderSettings("general")
		await user.click(screen.getByRole("button", { name: "Sign out" }))
		await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
	})

	it("drops the Security tab and sends /settings/security to General while redaction is switched off", async () => {
		renderSettings("security", { redaction: { redaction: "on", canChange: true, enabled: false } })
		expect(await screen.findByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page")
		expect(screen.queryByRole("link", { name: "Security" })).not.toBeInTheDocument()
		expect(screen.queryByRole("switch", { name: /Redact by default/ })).not.toBeInTheDocument()
	})

	it("groups the audit log by day, each request with its action, client, time and person", async () => {
		vi.spyOn(apiClient.ledger, "activity").mockResolvedValue({
			items: [entry("call-1", 1), entry("call-2", 2, { action: "artifact_search" })],
			nextCursor: null,
		})
		renderSettings("audit")
		const today = await screen.findByRole("region", { name: "Today" })
		expect(within(today).getAllByRole("listitem")).toHaveLength(2)
		expect(within(today).getByText("read")).toBeInTheDocument()
		expect(within(today).getByText("search")).toBeInTheDocument()
		expect(within(today).getAllByText("Claude Desktop")).toHaveLength(2)
		expect(within(today).getAllByText("Grace Hopper")).toHaveLength(2)
		expect(within(today).getByText("Search across artifacts")).toBeInTheDocument()
	})

	it("leaves the redaction switch's entries out of the audit log while redaction is off", async () => {
		vi.spyOn(apiClient.ledger, "activity").mockResolvedValue({
			items: [
				entry("call-1", 1),
				entry("switch-1", 2, { action: "workspace.redaction.on", artifactId: null, revisionId: null }),
			],
			nextCursor: null,
		})
		renderSettings("audit", {
			redaction: { redaction: "on", canChange: true, enabled: false },
		})
		const today = await screen.findByRole("region", { name: "Today" })
		expect(within(today).getAllByRole("listitem")).toHaveLength(1)
		expect(screen.queryByText("AI redaction default: on")).not.toBeInTheDocument()
	})

	it("shows a long log thirty requests at a time", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.ledger, "activity").mockResolvedValue({
			items: Array.from({ length: 32 }, (_, index) => entry(`call-${index}`, index + 1)),
			nextCursor: null,
		})
		renderSettings("audit")
		expect(await screen.findAllByRole("listitem")).toHaveLength(30)
		await user.click(screen.getByRole("button", { name: "Show more" }))
		expect(screen.getAllByRole("listitem")).toHaveLength(32)
		expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument()
	})

	it("tells a non-admin the audit log is for admins", () => {
		renderSettings("audit", { isAdmin: false })
		expect(screen.getByText("Only workspace admins can read the audit log.")).toBeInTheDocument()
	})

	it("says an empty window is empty, and a failed read failed with a Retry", async () => {
		const { unmount } = renderSettings("audit")
		expect(await screen.findByText("No client requests in the last 90 days.")).toBeInTheDocument()
		unmount()

		vi.spyOn(apiClient.ledger, "activity").mockRejectedValue(new Error("Ledger down"))
		renderSettings("audit")
		expect(await screen.findByText("Ledger down")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
	})
})
