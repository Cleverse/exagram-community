import { type ActivityEntry, ApiError } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LATER_PREFERENCES, me, renderSettings, stubSettingsApi, useCommunityTeam } from "./SettingsPage.mobile.harness"

import { apiClient } from "@/config/apiClient"
import { edition } from "@/edition/edition"
import { RESET_LINK_REFUSED } from "@/features/settings/hooks/useResetLinks"
import { expectTapHeight } from "@/test/tapTarget"

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
	const notifications = edition.notificationSettings ? ["Notifications"] : []

	it("heads every tab with Settings and the Workspace, and tabs General, Team, Audit and any Notifications", () => {
		renderSettings("general", { redaction: { redaction: "on", canChange: true, enabled: false } })
		expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument()
		const tabs = within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("link")
		expect(tabs.map((link) => link.textContent)).toEqual(["General", "Team", "Audit", ...notifications])
		expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page")
	})

	it("sets every tab 44px tall", () => {
		renderSettings("general")
		const tabs = within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("link")
		expect(tabs).not.toHaveLength(0)
		for (const tab of tabs) expectTapHeight(tab)
	})

	it("tabs only General and any Notifications in a Personal Workspace, named as the library", () => {
		renderSettings("general", { workspaceKind: "personal" })
		expect(screen.getByText("Personal Workspace")).toBeInTheDocument()
		// A single tab draws no tab bar.
		const tabs = within(screen.queryByRole("navigation", { name: "Settings" }) ?? document.createElement("nav"))
			.queryAllByRole("link")
			.map((link) => link.textContent)
		expect(tabs).toEqual(notifications.length > 0 ? ["General", ...notifications] : [])
		expect(screen.queryByRole("radiogroup", { name: "Edition" })).not.toBeInTheDocument()
	})

	it("sends /settings/audit to General in a Personal Workspace", () => {
		renderSettings("audit", { workspaceKind: "personal" })
		expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument()
		expect(screen.queryByText("Every request, whoever made it. Kept for 90 days.")).not.toBeInTheDocument()
	})

	it("adds the Team tab for a person with no Team, and opens the Create team drawer from it", async () => {
		const user = userEvent.setup()
		renderSettings("team", { workspaceKind: "personal", noTeam: true })
		const tabs = within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("link")
		expect(tabs.map((link) => link.textContent)).toEqual(["General", "Team", ...notifications])
		expect(screen.getByText("You don't have a team yet")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Create team" }))
		expect(await screen.findByRole("dialog", { name: "createTeam" })).toBeInTheDocument()
	})

	it("moves between tabs by address", async () => {
		const user = userEvent.setup()
		renderSettings("general")
		await user.click(screen.getByRole("link", { name: "Team" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/team")
		expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument()
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

	it.skipIf(!edition.notificationSettings)(
		"shows the four notification switches to every member, and saves one as it moves",
		async () => {
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
		},
	)

	it.skipIf(!edition.notificationSettings)(
		"leaves Approvals out of the app switches in a Personal Workspace, and saves it unchanged",
		async () => {
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
		},
	)

	it.skipIf(edition.notificationSettings)(
		"sends /settings/notifications to General where the edition has no such tab",
		() => {
			renderSettings("notifications")
			expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page")
			expect(screen.queryByRole("link", { name: "Notifications" })).not.toBeInTheDocument()
		},
	)

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

	it("offers Connect Apple on General while the install has it and the account has not linked one", () => {
		const { unmount } = renderSettings("general", { apple: { offered: true, linked: false } })
		expect(screen.getByRole("link", { name: "Connect Apple" })).toHaveAttribute(
			"href",
			expect.stringContaining("/v1/auth/apple/start?mode=link"),
		)
		unmount()
		renderSettings("general", { apple: { offered: true, linked: true } })
		expect(screen.queryByRole("link", { name: "Connect Apple" })).not.toBeInTheDocument()
		expect(screen.getByText("Connected")).toBeInTheDocument()
	})

	it("offers Delete account at the foot of General, opening its drawer", async () => {
		const user = userEvent.setup()
		renderSettings("general")

		await user.click(screen.getByRole("button", { name: "Delete account" }))

		expect(await screen.findByRole("dialog", { name: "deleteAccount" })).toBeInTheDocument()
	})

	it("keeps Delete account off the other tabs", () => {
		renderSettings("audit")

		expect(screen.getByText("Every request, whoever made it. Kept for 90 days.")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument()
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

	it("groups the audit log by day, each request with its action, origin, time and person", async () => {
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

	it("says every request is kept, whoever made it, above the log", async () => {
		renderSettings("audit")
		expect(screen.getByText("Every request, whoever made it. Kept for 90 days.")).toBeInTheDocument()
		expect(await screen.findByText("No requests in the last 90 days.")).toBeInTheDocument()
	})

	it("tells a non-admin the audit log is for admins", () => {
		renderSettings("audit", { isAdmin: false })
		expect(screen.getByText("Only workspace admins can read the audit log.")).toBeInTheDocument()
	})

	it("says an empty window is empty, and a failed read failed with a Retry", async () => {
		const { unmount } = renderSettings("audit")
		expect(await screen.findByText("No requests in the last 90 days.")).toBeInTheDocument()
		unmount()

		vi.spyOn(apiClient.ledger, "activity").mockRejectedValue(new Error("Ledger down"))
		renderSettings("audit")
		expect(await screen.findByText("Ledger down")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
	})
})
