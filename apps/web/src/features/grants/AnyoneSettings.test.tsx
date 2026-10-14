import { ApiError, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ShareDialog } from "./ShareDialog"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useArtifact } from "@/features/artifact/hooks/useArtifact"
import { artifactFixture } from "@/features/artifact/sheets/sheetHarness"
import { anyoneSettings, fakeAnyoneServer } from "@/test/anyoneServer"
import { sessionIn } from "@/test/workspaces"

// Twelve characters as 4-4-4, none of 0 O 1 l I (and no i, o or L either).
const GENERATED = /^[a-hj-km-np-zA-HJ-KM-NP-Z2-9]{4}-[a-hj-km-np-zA-HJ-KM-NP-Z2-9]{4}-[a-hj-km-np-zA-HJ-KM-NP-Z2-9]{4}$/

const owned = (over: Partial<VisibleArtifact> = {}) =>
	artifactFixture({
		access: "owner",
		generalAccess: "anyone",
		anyoneSettings: anyoneSettings(),
		...over,
	})

/** The Share dialog on an Artifact read from the cache, as the pages hand it over, so a saved setting redraws it. */
function showShare(value: VisibleArtifact, onClose: () => void = () => {}) {
	vi.spyOn(apiClient.grants, "list").mockResolvedValue([])
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.artifacts.get(value.id), value)
	client.setQueryData(QueryKeys.grants.access(value.id), value.access)
	client.setQueryData(QueryKeys.auth.me(), {
		id: value.ownerId,
		name: "Ada",
		email: "ada@example.test",
		...sessionIn("team", value.workspaceId),
	})
	client.setQueryData(QueryKeys.revisions.list(value.id), [])
	const Live = () => {
		const file = useArtifact(value.id)
		return file.data ? <ShareDialog artifact={file.data} onClose={onClose} /> : null
	}
	return render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<Live />
			</ToastProvider>
		</QueryClientProvider>,
	)
}

const linkSettingsButton = () => screen.getByRole("button", { name: /^Link settings/ })
const popover = () => screen.getByRole("dialog", { name: "Link settings" })

const openPopover = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.click(linkSettingsButton())
	return popover()
}

beforeEach(() => {
	vi.spyOn(apiClient.ledger, "viewers").mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe("General access: Anyone with the link", () => {
	it("is a globe row that says what it lets in, for the Owner and for a reader who cannot see the password", () => {
		showShare(owned())
		expect(screen.getByRole("button", { name: "General access" })).toHaveTextContent("Anyone with the link")
		expect(screen.getByText("Anyone on the internet with the link can view")).toBeInTheDocument()
	})

	it("says the password is needed once the Owner turned it on", () => {
		showShare(owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }))
		expect(screen.getByText("Anyone with the link and password can view")).toBeInTheDocument()
	})

	it("claims nothing about a password to a reader who is not told", () => {
		showShare(artifactFixture({ access: "collaborate", generalAccess: "anyone", anyoneSettings: null }))
		expect(screen.getByText("Anyone with the link can view")).toBeInTheDocument()
		expect(screen.queryByText(/and password/)).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /^Link settings/ })).not.toBeInTheDocument()
	})

	it("offers Link settings to the Owner only while the file is open to Anyone with the link", () => {
		showShare(owned())
		expect(linkSettingsButton()).toHaveAttribute("aria-expanded", "false")
	})

	it.each(["restricted", "org"] as const)("has no Link settings under %s", (generalAccess) => {
		showShare(owned({ generalAccess, anyoneSettings: anyoneSettings() }))
		expect(screen.queryByRole("button", { name: /^Link settings/ })).not.toBeInTheDocument()
	})

	it("says so when the Owner opens the file to Anyone with the link", async () => {
		vi.spyOn(apiClient.artifacts, "setGeneralAccess").mockResolvedValue(owned())
		showShare(owned({ generalAccess: "restricted" }))
		const user = userEvent.setup()
		await user.click(screen.getByRole("button", { name: "General access" }))
		await user.click(screen.getByRole("menuitemradio", { name: "Anyone with the link" }))
		expect(await screen.findByText("Anyone with the link can now view.")).toBeInTheDocument()
	})
})

describe("Link settings popover", () => {
	it("opens from the button, marks it expanded, and shows the three settings", async () => {
		showShare(owned())
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		expect(linkSettingsButton()).toHaveAttribute("aria-expanded", "true")
		expect(within(dialog).getByRole("switch", { name: "Require password" })).not.toBeChecked()
		expect(within(dialog).getByText("Add a password for extra protection.")).toBeInTheDocument()
		expect(within(dialog).getByRole("combobox", { name: "Link expires" })).toHaveDisplayValue("Never")
		expect(within(dialog).getByText("The link works until you change access.")).toBeInTheDocument()
		expect(within(dialog).getByRole("switch", { name: "Allow download" })).toBeChecked()
		expect(within(dialog).getByText("Recipients can view and download.")).toBeInTheDocument()
		// Nothing about a password to preview yet.
		expect(within(dialog).queryByRole("button", { name: "Preview as recipient" })).not.toBeInTheDocument()
	})

	it("closes on its button again, on ×, and on a click outside, leaving the Share dialog open", async () => {
		const onClose = vi.fn()
		showShare(owned(), onClose)
		const user = userEvent.setup()
		await openPopover(user)
		await user.click(linkSettingsButton())
		expect(screen.queryByRole("dialog", { name: "Link settings" })).not.toBeInTheDocument()

		await openPopover(user)
		await user.click(within(popover()).getByRole("button", { name: "Close" }))
		expect(screen.queryByRole("dialog", { name: "Link settings" })).not.toBeInTheDocument()

		await openPopover(user)
		await user.click(screen.getByRole("heading", { name: "Share file" }))
		expect(screen.queryByRole("dialog", { name: "Link settings" })).not.toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "Share" })).toBeInTheDocument()
		expect(onClose).not.toHaveBeenCalled()
	})

	it("closes on Escape without closing the Share dialog, then Escape closes the dialog", async () => {
		const onClose = vi.fn()
		showShare(owned(), onClose)
		const user = userEvent.setup()
		await openPopover(user)
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog", { name: "Link settings" })).not.toBeInTheDocument()
		expect(onClose).not.toHaveBeenCalled()
		expect(linkSettingsButton()).toHaveFocus()

		await user.keyboard("{Escape}")
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it("stays open while a setting is clicked inside it", async () => {
		fakeAnyoneServer(owned())
		showShare(owned())
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		await user.click(within(dialog).getByRole("switch", { name: "Allow download" }))
		expect(popover()).toBeInTheDocument()
	})
})

describe("Require password", () => {
	it("generates a password the first time and saves it with the switch", async () => {
		const save = fakeAnyoneServer(owned())
		showShare(owned())
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		await user.click(within(dialog).getByRole("switch", { name: "Require password" }))

		expect(save).toHaveBeenCalledTimes(1)
		const [sent] = save.mock.calls[0] ?? []
		expect(sent).toMatchObject({ artifactId: "a1", passwordOn: true })
		expect(sent?.password).toMatch(GENERATED)
		expect(await screen.findByText("Link is now password protected.")).toBeInTheDocument()

		// The Owner may see it now: masked until Show, and the same text either way.
		const field = await within(popover()).findByLabelText("Password")
		expect(field).toHaveAttribute("type", "password")
		expect(field).toHaveValue(sent?.password)
		await user.click(within(popover()).getByRole("button", { name: "Show password" }))
		expect(within(popover()).getByLabelText("Password")).toHaveAttribute("type", "text")
		await user.click(within(popover()).getByRole("button", { name: "Hide password" }))
		expect(within(popover()).getByLabelText("Password")).toHaveAttribute("type", "password")

		expect(within(popover()).getByText("People must enter the password to open the link.")).toBeInTheDocument()
		expect(within(popover()).getByText("Send the password separately from the link.")).toBeInTheDocument()
		expect(linkSettingsButton()).toHaveTextContent("Password on")
		expect(screen.getByText("Anyone with the link and password can view")).toBeInTheDocument()
	})

	it("turns an already stored password back on without sending one, and off without losing it", async () => {
		const save = fakeAnyoneServer(owned({ anyoneSettings: anyoneSettings({ passwordSet: true }) }))
		showShare(owned({ anyoneSettings: anyoneSettings({ passwordSet: true }) }))
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		await user.click(within(dialog).getByRole("switch", { name: "Require password" }))
		expect(save).toHaveBeenLastCalledWith({ artifactId: "a1", passwordOn: true })
		expect(await screen.findByText("Link is now password protected.")).toBeInTheDocument()

		await user.click(within(popover()).getByRole("switch", { name: "Require password" }))
		expect(save).toHaveBeenLastCalledWith({ artifactId: "a1", passwordOn: false })
		expect(await screen.findByText("Password removed from the link.")).toBeInTheDocument()
		await waitFor(() => expect(within(popover()).queryByLabelText("Password")).not.toBeInTheDocument())
	})

	it("shows a stored password as set, not as text, and cannot copy what it does not know", async () => {
		const start = owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) })
		showShare(start)
		const dialog = await openPopover(userEvent.setup())
		const field = within(dialog).getByLabelText("Password")
		expect(field).toHaveValue("")
		expect(field).toHaveAttribute("placeholder", "Password set. Type a new one or generate one.")
		expect(within(dialog).getByRole("button", { name: "Copy password" })).toBeDisabled()
	})

	it("rotates the password with Generate new password, shows it, and says the old one stops working", async () => {
		const save = fakeAnyoneServer(owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }))
		showShare(owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }))
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		await user.click(within(dialog).getByRole("button", { name: "Generate new password" }))

		const [sent] = save.mock.calls[0] ?? []
		expect(sent?.password).toMatch(GENERATED)
		expect(sent).not.toHaveProperty("passwordOn")
		expect(await screen.findByText("New password generated. The old one stops working.")).toBeInTheDocument()
		const field = within(popover()).getByLabelText("Password")
		await waitFor(() => expect(field).toHaveValue(sent?.password))
		expect(field).toHaveAttribute("type", "text")
	})

	it("copies the password it knows and says so", async () => {
		fakeAnyoneServer(owned())
		showShare(owned())
		const user = userEvent.setup()
		const writeText = vi.spyOn(navigator.clipboard, "writeText")
		await user.click(within(await openPopover(user)).getByRole("switch", { name: "Require password" }))
		const field = await within(popover()).findByLabelText("Password")
		await waitFor(() => expect(field).not.toHaveValue(""))
		await user.click(within(popover()).getByRole("button", { name: "Copy password" }))
		expect(writeText).toHaveBeenCalledWith((field as HTMLInputElement).value)
		expect(await screen.findByText("Password copied.")).toBeInTheDocument()
	})

	it("keeps a typed password under 8 characters unsaved and says why, then saves one that is long enough on Enter", async () => {
		const save = fakeAnyoneServer(owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }))
		showShare(owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }))
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		const field = within(dialog).getByLabelText("Password")

		await user.type(field, "abc")
		expect(within(dialog).getByRole("alert")).toHaveTextContent("Use at least 8 characters.")
		await user.tab()
		expect(save).not.toHaveBeenCalled()
		expect(within(dialog).getByRole("alert")).toHaveTextContent("Use at least 8 characters.")

		await user.type(field, "defgh{Enter}")
		expect(save).toHaveBeenCalledTimes(1)
		expect(save).toHaveBeenCalledWith({ artifactId: "a1", password: "abcdefgh" })
		expect(await screen.findByText("Password updated. The old one stops working.")).toBeInTheDocument()
		await waitFor(() => expect(within(popover()).queryByRole("alert")).not.toBeInTheDocument())
		expect(field).toHaveValue("abcdefgh")
	})

	it("saves a typed password once when Enter is followed by leaving the field", async () => {
		const save = fakeAnyoneServer(owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }))
		showShare(owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }))
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		await user.type(within(dialog).getByLabelText("Password"), "correct-horse{Enter}")
		await user.tab()
		await waitFor(() => expect(within(popover()).getByLabelText("Password")).toHaveValue("correct-horse"))
		expect(save).toHaveBeenCalledTimes(1)
	})

	it("saves a long enough typed password when the field is left", async () => {
		const save = fakeAnyoneServer(owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }))
		showShare(owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }))
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		await user.type(within(dialog).getByLabelText("Password"), "correct-horse")
		await user.tab()
		expect(save).toHaveBeenCalledWith({ artifactId: "a1", password: "correct-horse" })
	})

	it("shows the server's reason when it refuses", async () => {
		vi.spyOn(apiClient.artifacts, "setAnyoneSettings").mockRejectedValue(new ApiError(400, "Set a password first."))
		showShare(owned())
		const user = userEvent.setup()
		await user.click(within(await openPopover(user)).getByRole("switch", { name: "Require password" }))
		expect(await within(popover()).findByRole("alert")).toHaveTextContent("Set a password first.")
		expect(within(popover()).getByRole("switch", { name: "Require password" })).not.toBeChecked()
	})
})

describe("Link expires and Allow download", () => {
	it("saves the chosen number of days, then shows the date it ends as the selected option", async () => {
		const save = fakeAnyoneServer(owned())
		showShare(owned())
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		await user.selectOptions(within(dialog).getByRole("combobox", { name: "Link expires" }), "After 7 days")
		expect(save).toHaveBeenCalledWith({ artifactId: "a1", expiresInDays: 7 })

		const select = within(popover()).getByRole("combobox", { name: "Link expires" })
		await waitFor(() => expect(select).toHaveDisplayValue(/^Expires /))
		expect(within(popover()).getByText(/^The link stops working on /)).toBeInTheDocument()
		// The four fixed choices are still there beside it.
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([expect.stringMatching(/^Expires /), "Never", "After 1 day", "After 7 days", "After 30 days"])

		await user.selectOptions(select, "Never")
		expect(save).toHaveBeenLastCalledWith({ artifactId: "a1", expiresInDays: null })
		await waitFor(() => expect(select).toHaveDisplayValue("Never"))
		expect(within(select).getAllByRole("option")).toHaveLength(4)
	})

	it("shows an expiry already on the file, and Expired once it has passed", async () => {
		const later = new Date(Date.now() + 5 * 86_400_000)
		showShare(owned({ anyoneSettings: anyoneSettings({ expiresAt: later }) }))
		const user = userEvent.setup()
		await openPopover(user)
		expect(within(popover()).getByRole("combobox", { name: "Link expires" })).toHaveDisplayValue(/^Expires /)
	})

	it("reads Expired for an expiry that has passed", async () => {
		showShare(owned({ anyoneSettings: anyoneSettings({ expiresAt: new Date(Date.now() - 86_400_000) }) }))
		await openPopover(userEvent.setup())
		expect(within(popover()).getByRole("combobox", { name: "Link expires" })).toHaveDisplayValue("Expired")
		expect(within(popover()).getByText(/This link has expired\./)).toBeInTheDocument()
	})

	it("saves Allow download and says what it means", async () => {
		const save = fakeAnyoneServer(owned())
		showShare(owned())
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		await user.click(within(dialog).getByRole("switch", { name: "Allow download" }))
		expect(save).toHaveBeenCalledWith({ artifactId: "a1", download: false })
		await waitFor(() => expect(within(popover()).getByText("Recipients can view only.")).toBeInTheDocument())
		expect(within(popover()).getByRole("switch", { name: "Allow download" })).not.toBeChecked()
	})
})

describe("Preview as recipient", () => {
	const withPassword = () => owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) })

	it("closes the popover and draws the gate over the dialog, and Open asks the server for real", async () => {
		const unlock = vi.spyOn(apiClient.artifacts, "unlock").mockResolvedValue(undefined)
		showShare(withPassword())
		const user = userEvent.setup()
		await user.click(within(await openPopover(user)).getByRole("button", { name: "Preview as recipient" }))
		expect(screen.queryByRole("dialog", { name: "Link settings" })).not.toBeInTheDocument()

		const preview = screen.getByRole("dialog", { name: "Recipient preview" })
		expect(within(preview).getByRole("heading", { name: "Enter password to open" })).toBeInTheDocument()
		await user.type(within(preview).getByLabelText("Password"), "right-one{Enter}")
		expect(unlock).toHaveBeenCalledWith({ artifactId: "a1", password: "right-one" })
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recipient preview" })).not.toBeInTheDocument())
		expect(screen.getByRole("dialog", { name: "Share" })).toBeInTheDocument()
	})

	it("exits with Escape back to the Share dialog, which stays open", async () => {
		const onClose = vi.fn()
		showShare(withPassword(), onClose)
		const user = userEvent.setup()
		await user.click(within(await openPopover(user)).getByRole("button", { name: "Preview as recipient" }))
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog", { name: "Recipient preview" })).not.toBeInTheDocument()
		expect(onClose).not.toHaveBeenCalled()
		expect(linkSettingsButton()).toHaveFocus()
	})

	it("is blocked, with a toast, while the password being typed is under 8 characters", async () => {
		showShare(withPassword())
		const user = userEvent.setup()
		const dialog = await openPopover(user)
		await user.type(within(dialog).getByLabelText("Password"), "abc")
		await user.click(within(dialog).getByRole("button", { name: "Preview as recipient" }))
		expect(await screen.findByText("Use at least 8 characters first.")).toBeInTheDocument()
		expect(screen.queryByRole("dialog", { name: "Recipient preview" })).not.toBeInTheDocument()
		expect(popover()).toBeInTheDocument()
	})
})

describe("Copy link", () => {
	it.each([
		[
			"a password",
			owned({ anyoneSettings: anyoneSettings({ passwordOn: true, passwordSet: true }) }),
			"Link copied. Send the password separately.",
		],
		["no password", owned(), "Link copied — anyone with it can open."],
		[
			"invited people",
			owned({ generalAccess: "restricted", anyoneSettings: anyoneSettings() }),
			"Link copied — only invited people can open it.",
		],
	])("says who can open it for %s", async (_state, artifact, message) => {
		showShare(artifact)
		const user = userEvent.setup()
		const writeText = vi.spyOn(navigator.clipboard, "writeText")
		await user.click(screen.getByRole("button", { name: "Copy link" }))
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/artifacts/${artifact.id}`)
		expect(await screen.findByText(message)).toBeInTheDocument()
	})
})

describe("a reader who may not download", () => {
	it("is told they can view this", () => {
		showShare(artifactFixture({ access: "view", generalAccess: "anyone", canDownload: false, anyoneSettings: null }))
		expect(screen.getByText(/You can view this\. Ask a Collaborator/)).toBeInTheDocument()
		expect(screen.queryByText(/and download/)).not.toBeInTheDocument()
	})
})
