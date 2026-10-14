import { ApiError } from "@exagram/api-client"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LATER_PREFERENCES, renderAt, stubSettingsApi } from "./SettingsPage.harness"

import { apiClient } from "@/config/apiClient"
import { edition } from "@/edition/edition"
import { RESET_LINK_REFUSED } from "@/features/settings/hooks/useResetLinks"

describe("SettingsPage", () => {
	afterEach(() => vi.restoreAllMocks())

	beforeEach(() => {
		stubSettingsApi()
	})

	it("lets an Admin create a reset link when the install allows it, shown and copied once with its hour", async () => {
		vi.spyOn(apiClient.workspace, "listInvites").mockResolvedValue({ items: [], passwordReset: true })
		const user = userEvent.setup()
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
		const url = `https://app.example.test/reset/${"R".repeat(43)}`
		const create = vi
			.spyOn(apiClient.workspace, "createResetLink")
			.mockResolvedValue({ url, expiresAt: new Date(Date.now() + 3_600_000) })
		renderAt("/settings/general")

		expect(await screen.findByRole("heading", { level: 2, name: "Reset a password" })).toBeInTheDocument()
		await user.type(screen.getByLabelText("Member's email"), "member@example.com")
		await user.click(screen.getByRole("button", { name: "Create reset link" }))

		expect(create).toHaveBeenCalledWith({ email: "member@example.com" })
		expect(await screen.findByText(url)).toBeInTheDocument()
		expect(screen.getByText(/Reset link for member@example\.com\..*expires in 1 hour/)).toBeInTheDocument()
		expect(writeText).toHaveBeenCalledWith(url)
		await user.click(screen.getByRole("button", { name: "Copy reset link" }))
		expect(writeText).toHaveBeenCalledTimes(2)
	})

	it("shows a refused reset link as an error and no link", async () => {
		vi.spyOn(apiClient.workspace, "listInvites").mockResolvedValue({ items: [], passwordReset: true })
		vi.spyOn(apiClient.workspace, "createResetLink").mockRejectedValue(new Error("Could not create a reset link"))
		const user = userEvent.setup()
		renderAt("/settings/general")

		await user.type(await screen.findByLabelText("Member's email"), "stranger@example.com")
		await user.click(screen.getByRole("button", { name: "Create reset link" }))
		expect(await screen.findByText("Could not create a reset link")).toBeInTheDocument()
		expect(screen.queryByText(/\/reset\//)).not.toBeInTheDocument()
	})

	it("explains a refused reset link instead of the server's refusal text, and keeps any other error's message", async () => {
		vi.spyOn(apiClient.workspace, "listInvites").mockResolvedValue({ items: [], passwordReset: true })
		vi.spyOn(apiClient.workspace, "createResetLink")
			.mockRejectedValueOnce(new ApiError(404, "Could not create a reset link"))
			.mockRejectedValueOnce(new ApiError(429, "Too many requests."))
		const user = userEvent.setup()
		renderAt("/settings/general")

		await user.type(await screen.findByLabelText("Member's email"), "admin@example.com")
		await user.click(screen.getByRole("button", { name: "Create reset link" }))
		expect(await screen.findByText(RESET_LINK_REFUSED)).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Create reset link" }))
		expect(await screen.findByText("Too many requests.")).toBeInTheDocument()
		expect(screen.queryByText(RESET_LINK_REFUSED)).not.toBeInTheDocument()
	})

	it("hides Reset a password when the install does not allow it", async () => {
		const list = vi.spyOn(apiClient.workspace, "listInvites")
		renderAt("/settings/general")
		await waitFor(() => expect(list).toHaveBeenCalled())
		expect(await screen.findByRole("heading", { level: 1, name: "General" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { level: 2, name: "Reset a password" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Create reset link" })).not.toBeInTheDocument()
	})

	it("keeps Invites off General now that they live on Team", async () => {
		renderAt("/settings/general")
		expect(await screen.findByRole("heading", { level: 1, name: "General" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { level: 2, name: "Invites" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Create invite link" })).not.toBeInTheDocument()
	})

	it("asks a non-Admin for no Invites on General", () => {
		const list = vi.spyOn(apiClient.workspace, "listInvites")
		list.mockClear()
		renderAt("/settings/general", false, false)
		expect(screen.queryByRole("heading", { level: 2, name: "Reset a password" })).not.toBeInTheDocument()
		expect(list).not.toHaveBeenCalled()
	})

	it("shows the Ledger on Audit, and a refused read as an error rather than sample rows", async () => {
		renderAt("/settings/audit")
		expect(screen.getByRole("heading", { level: 1, name: "Audit" })).toBeInTheDocument()
		expect(
			screen.getByText(
				/Every request is recorded, whoever made it: who, what it asked for, and which revision it received\. Content never appears here\./,
			),
		).toBeInTheDocument()
		// The mocked ledger read rejects: the tab says so and offers a retry, and never falls back to a sample log.
		expect(await screen.findByRole("alert")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument()
	})

	it("shows the signed-in person on General, with Connect Google and Sign out", () => {
		renderAt("/settings/general")
		expect(screen.getByRole("heading", { level: 2, name: "Account" })).toBeInTheDocument()
		expect(screen.getByText("Person")).toBeInTheDocument()
		expect(screen.getByText("person@example.com")).toBeInTheDocument()
		expect(screen.getByText("Not connected")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Connect Google" })).toHaveAttribute(
			"href",
			expect.stringContaining("/v1/auth/google/start?mode=link"),
		)
		expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument()
	})

	it("offers Delete account at the foot of General, opening a confirmation that names the account's address", async () => {
		const user = userEvent.setup()
		renderAt("/settings/general", false, false, true, "personal", true)

		expect(screen.getByRole("heading", { level: 2, name: "Delete account" })).toBeInTheDocument()
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Delete account" }))

		const dialog = screen.getByRole("dialog", { name: "Delete your account?" })
		expect(within(dialog).getByLabelText("Type your email address to confirm")).toHaveAccessibleDescription(
			"person@example.com",
		)
		await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})

	it("keeps Delete account off the other tabs", async () => {
		renderAt("/settings/audit")

		expect(await screen.findByRole("heading", { level: 1, name: "Audit" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument()
	})

	it.skipIf(edition.notificationSettings)(
		"sends /settings/notifications to General where the edition has no such tab",
		async () => {
			renderAt("/settings/notifications")
			expect(await screen.findByRole("heading", { level: 1, name: "General" })).toBeInTheDocument()
			expect(screen.queryByRole("link", { name: "Notifications" })).not.toBeInTheDocument()
		},
	)

	it("leaves Apple out of General on an install without it", () => {
		renderAt("/settings/general")
		expect(screen.queryByText("Apple")).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Connect Apple" })).not.toBeInTheDocument()
	})

	it("offers Connect Apple while the install has it and the account has not linked one, then drops it", () => {
		const { unmount } = renderAt("/settings/general", true, true, true, "team", false, { offered: true })
		expect(screen.getByText("Apple")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Connect Apple" })).toHaveAttribute(
			"href",
			expect.stringContaining("/v1/auth/apple/start?mode=link"),
		)
		unmount()
		renderAt("/settings/general", true, true, true, "team", false, { offered: true, linked: true })
		expect(screen.queryByRole("link", { name: "Connect Apple" })).not.toBeInTheDocument()
		expect(screen.getAllByText("Connected")).toHaveLength(2)
	})

	it("drops Connect Google once Google is linked", () => {
		renderAt("/settings/general", true)
		expect(screen.queryByRole("link", { name: "Connect Google" })).not.toBeInTheDocument()
		expect(screen.getByText("Connected")).toBeInTheDocument()
	})

	it.skipIf(!edition.notificationSettings)(
		"shows a member's four notification switches, each saving all four at once",
		async () => {
			// The server keeps what it was last sent, so the read-back after a save agrees with it.
			let saved = { ...LATER_PREFERENCES, accessRequests: true, pendingRevisions: true, grants: false, comments: true }
			vi.spyOn(apiClient.notifications, "getPreferences").mockImplementation(() => Promise.resolve(saved))
			const set = vi.spyOn(apiClient.notifications, "setPreferences").mockImplementation((prefs) => {
				saved = prefs
				return Promise.resolve(prefs)
			})
			const user = userEvent.setup()
			renderAt("/settings/notifications", false, false)

			expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument()
			expect(screen.getByText(/appear in the Exagram apps for Mac and iPhone/)).toBeInTheDocument()
			const switches = await within(screen.getByRole("region", { name: "Notify me when" })).findAllByRole("switch")
			expect(
				switches.map((control) => [control.getAttribute("aria-label"), control.getAttribute("aria-checked")]),
			).toEqual([
				["Access requests", "true"],
				["Approvals", "true"],
				["Shared with you", "false"],
				["Comments", "true"],
			])

			await user.click(screen.getByRole("switch", { name: "Shared with you" }))
			// Moves at once, before the save answers.
			expect(screen.getByRole("switch", { name: "Shared with you" })).toHaveAttribute("aria-checked", "true")
			expect(set).toHaveBeenCalledWith({
				...LATER_PREFERENCES,
				accessRequests: true,
				pendingRevisions: true,
				grants: true,
				comments: true,
			})

			await user.click(screen.getByRole("switch", { name: "Comments" }))
			expect(set).toHaveBeenLastCalledWith({
				...LATER_PREFERENCES,
				accessRequests: true,
				pendingRevisions: true,
				grants: true,
				comments: false,
			})
		},
	)

	it.skipIf(!edition.notificationSettings)(
		"puts a notification switch back, and says so, when the save fails",
		async () => {
			vi.spyOn(apiClient.notifications, "getPreferences").mockResolvedValue({
				...LATER_PREFERENCES,
				accessRequests: true,
				pendingRevisions: true,
				grants: true,
				comments: true,
			})
			vi.spyOn(apiClient.notifications, "setPreferences").mockRejectedValue(
				new ApiError(500, "Could not save notification settings"),
			)
			const user = userEvent.setup()
			renderAt("/settings/notifications")

			await user.click(await screen.findByRole("switch", { name: "Access requests" }))
			await waitFor(() =>
				expect(screen.getByRole("switch", { name: "Access requests" })).toHaveAttribute("aria-checked", "true"),
			)
			expect(await screen.findByText("Could not save notification settings")).toBeInTheDocument()
		},
	)

	it.skipIf(!edition.notificationSettings)(
		"does not roll back a failed save while a later one is still in flight; the last read-back settles it",
		async () => {
			let saved = { ...LATER_PREFERENCES, accessRequests: true, pendingRevisions: true, grants: true, comments: true }
			const read = vi.spyOn(apiClient.notifications, "getPreferences").mockImplementation(() => Promise.resolve(saved))
			let failFirst: (error: Error) => void = () => undefined
			let finishSecond: () => void = () => undefined
			vi.spyOn(apiClient.notifications, "setPreferences")
				.mockImplementationOnce(() => new Promise((_resolve, reject) => (failFirst = reject)))
				.mockImplementationOnce(
					(prefs) =>
						new Promise((resolve) => {
							finishSecond = () => {
								saved = prefs
								resolve(prefs)
							}
						}),
				)
			const user = userEvent.setup()
			renderAt("/settings/notifications")

			await user.click(await screen.findByRole("switch", { name: "Access requests" }))
			await user.click(screen.getByRole("switch", { name: "Comments" }))
			failFirst(new ApiError(500, "Could not save notification settings"))
			expect(await screen.findByText("Could not save notification settings")).toBeInTheDocument()
			// The second save carried both changes; undoing the first on screen would contradict it.
			expect(screen.getByRole("switch", { name: "Access requests" })).toHaveAttribute("aria-checked", "false")
			expect(screen.getByRole("switch", { name: "Comments" })).toHaveAttribute("aria-checked", "false")

			const readsBefore = read.mock.calls.length
			finishSecond()
			await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(readsBefore))
			expect(screen.getByRole("switch", { name: "Access requests" })).toHaveAttribute("aria-checked", "false")
			expect(screen.getByRole("switch", { name: "Comments" })).toHaveAttribute("aria-checked", "false")
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
			renderAt("/settings/notifications", false, false, true, "personal")

			const app = within(screen.getByRole("region", { name: "Notify me when" }))
			expect(await app.findByRole("switch", { name: "Shared with you" })).toBeInTheDocument()
			expect(app.getAllByRole("switch").map((control) => control.getAttribute("aria-label"))).toEqual([
				"Access requests",
				"Shared with you",
				"Comments",
			])

			await user.click(app.getByRole("switch", { name: "Shared with you" }))
			expect(set).toHaveBeenCalledWith({
				...LATER_PREFERENCES,
				accessRequests: true,
				pendingRevisions: true,
				grants: true,
				comments: true,
			})
		},
	)

	it("has no Edition picker on General, whatever the Workspace", () => {
		const { unmount } = renderAt("/settings/general", false, true, true, "team")
		expect(screen.queryByRole("radiogroup", { name: "Edition" })).not.toBeInTheDocument()
		unmount()

		renderAt("/settings/general", false, true, true, "personal")
		expect(screen.queryByRole("radiogroup", { name: "Edition" })).not.toBeInTheDocument()
	})

	it("keeps an Admin's Team-only cards off General in a Personal Workspace", () => {
		renderAt("/settings/general", false, true, true, "personal")
		expect(screen.getByRole("heading", { level: 1, name: "General" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { level: 2, name: "Notification email" })).not.toBeInTheDocument()
		expect(screen.queryByRole("heading", { level: 2, name: "Reset a password" })).not.toBeInTheDocument()
	})

	it.each(["team", "security", "audit"])("sends /settings/%s to General in a Personal Workspace", (tab) => {
		renderAt(`/settings/${tab}`, false, true, true, "personal")
		expect(screen.getByRole("heading", { level: 1, name: "General" })).toBeInTheDocument()
	})

	it.each(["security", "audit"])("sends /settings/%s to General for a person with no Team too", (tab) => {
		renderAt(`/settings/${tab}`, false, true, true, "personal", true)
		expect(screen.getByRole("heading", { level: 1, name: "General" })).toBeInTheDocument()
	})

	it("makes the Team tab the place to create a team for a person with no Team", async () => {
		const user = userEvent.setup()
		renderAt("/settings/team", false, true, true, "personal", true)
		expect(screen.getByRole("heading", { level: 1, name: "Team" })).toBeInTheDocument()
		expect(screen.getByText("You don't have a team yet")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Create team" }))
		expect(screen.getByRole("dialog", { name: "Create team" })).toBeInTheDocument()
	})

	it("answers an unknown tab with the not-found page, Billing included for now", () => {
		for (const tab of ["billing", "organization"]) {
			const { unmount } = renderAt(`/settings/${tab}`)
			expect(screen.getByRole("alert")).toHaveTextContent("This page isn't available")
			unmount()
		}
	})
})
