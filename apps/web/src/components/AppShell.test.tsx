import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { renderShell } from "./AppShell.harness"

import type * as ToastModule from "@/components/Toast"
import type * as EnvModule from "@/config/env"

const { toast, uploadOne } = vi.hoisted(() => ({ toast: vi.fn(), uploadOne: vi.fn() }))

vi.mock("@/features/library/hooks/useUpload", () => ({
	useUpload: () => ({ mutateAsync: uploadOne, mutate: vi.fn(), isPending: false, discard: vi.fn() }),
}))

vi.mock("@/config/env", async (importOriginal) => ({
	...(await importOriginal<typeof EnvModule>()),
	API_ORIGIN: "https://api.example.test",
}))

vi.mock("@/components/Toast", async () => {
	const actual = await vi.importActual<typeof ToastModule>("@/components/Toast")
	return { ...actual, useToast: () => toast }
})

describe("AppShell Google account linking", () => {
	it("keeps Connect Google out of the account menu; it lives in Settings → General", async () => {
		const user = userEvent.setup()
		renderShell(false)

		await user.click(screen.getByTitle("Account"))
		expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument()
		expect(screen.queryByRole("menuitem", { name: "Connect Google" })).not.toBeInTheDocument()
	})

	it("shows a Google notice once under StrictMode", async () => {
		toast.mockClear()
		renderShell(false, { initialEntries: ["/?google=linked"], strict: true })

		await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
		expect(toast).toHaveBeenCalledWith("Google connected.")
	})

	it("shows a rate-limit notice for account linking", async () => {
		toast.mockClear()
		renderShell(false, { initialEntries: ["/?error=google_rate_limited"] })
		await waitFor(() =>
			expect(toast).toHaveBeenCalledWith("Too many Google sign-in attempts. Wait a minute and try again."),
		)
	})
})

describe("AppShell sidebar", () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	it("heads the sidebar with the brand linking to All artifacts", () => {
		renderShell(true)
		const sidebar = screen.getByRole("complementary", { name: "Library sidebar" })
		expect(within(sidebar).getByRole("link", { name: "Exagram" })).toHaveAttribute("href", "/")
		// The section switcher lives in the sidebar; there is no top bar.
		expect(within(sidebar).getByRole("navigation", { name: "Sections" })).toBeInTheDocument()
	})

	it("selects the section the route belongs to", () => {
		const { unmount } = renderShell(true, { initialEntries: ["/projects/p1"] })
		expect(screen.getByRole("link", { name: "Artifacts" })).toHaveAttribute("aria-current", "page")
		unmount()

		const context = renderShell(true, { initialEntries: ["/context?week=1"] })
		expect(screen.getByRole("link", { name: "Context" })).toHaveAttribute("aria-current", "page")
		expect(screen.getByRole("navigation", { name: "Weeks" })).toBeInTheDocument()
		context.unmount()

		renderShell(true, { initialEntries: ["/connections"] })
		expect(screen.getByRole("link", { name: "Artifacts" })).not.toHaveAttribute("aria-current")
		expect(screen.getByRole("link", { name: "Context" })).not.toHaveAttribute("aria-current")
		// MCP clients keeps the Artifacts body beside it.
		expect(screen.getByRole("link", { name: "All artifacts" })).toBeInTheDocument()
	})

	it("offers exactly the Artifacts and Context sections, as links", () => {
		renderShell(true)
		const sections = within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link")
		expect(sections.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
			["Artifacts", "/"],
			["Context", "/context"],
		])
	})

	it("navigates when a section tab is selected", async () => {
		const user = userEvent.setup()
		renderShell(true)

		await user.click(screen.getByRole("link", { name: "Context" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/context")
		expect(screen.getByRole("link", { name: /This week/ })).toHaveAttribute("aria-current", "page")

		await user.click(screen.getByRole("link", { name: "Artifacts" }))
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/)
	})

	it("picks the Context week from the sidebar and marks it", async () => {
		const user = userEvent.setup()
		renderShell(true, { initialEntries: ["/context"] })

		await user.click(screen.getByRole("link", { name: /Last week/ }))
		expect(screen.getByTestId("where")).toHaveTextContent("/context?week=1")
		expect(screen.getByRole("link", { name: /Last week/ })).toHaveAttribute("aria-current", "page")
		expect(screen.getByRole("link", { name: /This week/ })).not.toHaveAttribute("aria-current")
	})

	it("keeps the whole sidebar in place when a preview opens", async () => {
		const user = userEvent.setup()
		renderShell(true)
		const sidebar = screen.getByRole("complementary", { name: "Library sidebar" })

		await user.click(screen.getByRole("button", { name: "open preview" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/?preview=a1")
		expect(screen.getByRole("complementary", { name: "Library sidebar" })).toBe(sidebar)
		expect(within(sidebar).getByRole("navigation", { name: "Sections" })).toBeInTheDocument()
		expect(within(sidebar).getByRole("link", { name: "Inbox" })).toBeInTheDocument()
		expect(within(sidebar).getByTitle("Account")).toBeInTheDocument()
	})

	it("starts a new screen at its top, but keeps the scroll when only a preview opens", async () => {
		const user = userEvent.setup()
		renderShell(true)
		const main = screen.getByRole("main")

		main.scrollTop = 200
		await user.click(screen.getByRole("button", { name: "open preview" }))
		expect(main.scrollTop).toBe(200)

		await user.click(screen.getByRole("link", { name: "Context" }))
		expect(main.scrollTop).toBe(0)
	})

	it("collapses to the rail, keeps the account there, and remembers it across a reload", async () => {
		const user = userEvent.setup()
		const { unmount } = renderShell(true)

		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }))
		expect(screen.queryByRole("complementary", { name: "Library sidebar" })).not.toBeInTheDocument()
		const rail = screen.getByRole("complementary", { name: "Collapsed sidebar" })
		expect(within(rail).getByTitle("Account")).toBeInTheDocument()
		unmount()

		renderShell(true)
		expect(screen.getByRole("complementary", { name: "Collapsed sidebar" })).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Expand sidebar" }))
		expect(screen.getByRole("complementary", { name: "Library sidebar" })).toBeInTheDocument()
	})

	it("opens search from the sidebar and from the collapsed rail", async () => {
		const user = userEvent.setup()
		renderShell(true)

		const sidebar = screen.getByRole("complementary", { name: "Library sidebar" })
		await user.click(within(sidebar).getByRole("button", { name: "Search" }))
		expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument()
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }))
		const rail = screen.getByRole("complementary", { name: "Collapsed sidebar" })
		await user.click(within(rail).getByRole("button", { name: "Search" }))
		expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument()
	})
})

describe("AppShell account menu", () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	it("names the person on the account row", () => {
		renderShell(true)
		const account = screen.getByTitle("Account")
		expect(account).toHaveTextContent("Person")
	})

	it("names both account triggers Account and says they open a menu", async () => {
		const user = userEvent.setup()
		renderShell(true)
		const row = screen.getByRole("button", { name: "Account" })
		expect(row).toHaveAttribute("aria-haspopup", "menu")

		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }))
		const rail = within(screen.getByRole("complementary", { name: "Collapsed sidebar" }))
		expect(rail.getByRole("button", { name: "Account" })).toHaveAttribute("aria-haspopup", "menu")
	})

	it("focuses the first item on open and hands focus back to the trigger on Escape", async () => {
		const user = userEvent.setup()
		renderShell(true)
		const trigger = screen.getByRole("button", { name: "Account" })

		await user.click(trigger)
		expect(screen.getByRole("menuitem", { name: "MCP clients" })).toHaveFocus()
		await user.keyboard("{ArrowDown}")
		expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveFocus()
		await user.keyboard("{Escape}")
		expect(trigger).toHaveFocus()
	})

	it("lists MCP clients and Settings first, Sign out last, with no Switch organization for now", async () => {
		const user = userEvent.setup()
		renderShell(true)

		await user.click(screen.getByTitle("Account"))
		const menu = screen.getByRole("menu", { name: "Account" })
		const items = within(menu)
			.getAllByRole("menuitem")
			.map((item) => item.getAttribute("aria-label") ?? item.textContent)
		expect(items.slice(0, 2)).toEqual(["MCP clients", "Settings"])
		expect(items.at(-1)).toBe("Sign out")
		expect(items).not.toContain("Switch organization")
	})

	it("opens MCP clients and Settings", async () => {
		const user = userEvent.setup()
		renderShell(true)

		await user.click(screen.getByTitle("Account"))
		await user.click(screen.getByRole("menuitem", { name: "MCP clients" }))
		// A modal over the current screen, not a navigation.
		expect(screen.getByRole("dialog", { name: "MCP clients" })).toBeInTheDocument()
		expect(screen.getByTestId("where")).not.toHaveTextContent("/connections")
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog", { name: "MCP clients" })).not.toBeInTheDocument()

		await user.click(screen.getByTitle("Account"))
		await user.click(screen.getByRole("menuitem", { name: "Settings" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/general")
	})
})

describe("AppShell Settings", () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	it("replaces the app sidebar with the Settings sidebar", () => {
		renderShell(true, { initialEntries: ["/settings/audit"] })
		expect(screen.queryByRole("complementary", { name: "Library sidebar" })).not.toBeInTheDocument()
		const sidebar = within(screen.getByRole("complementary", { name: "Settings sidebar" }))
		const nav = within(sidebar.getByRole("navigation", { name: "Settings" }))
		// Security is the edition's page; Cloud lists it between Team and Audit (settingsTabs.ee.test.ts).
		expect(
			nav
				.getAllByRole("link")
				.map((link) => [link.textContent, link.getAttribute("href")])
				.filter(([name]) => name !== "Security"),
		).toEqual([
			["General", "/settings/general"],
			["Team", "/settings/team"],
			["Audit", "/settings/audit"],
			["Notifications", "/settings/notifications"],
		])
		expect(sidebar.getByText("Your account")).toBeInTheDocument()
		expect(nav.getByRole("link", { name: "Audit" })).toHaveAttribute("aria-current", "page")
		expect(nav.getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current")
	})

	it("goes back to All artifacts when the session started in Settings", () => {
		renderShell(true, { initialEntries: ["/settings/general"] })
		expect(screen.getByRole("link", { name: "Back to Exagram" })).toHaveAttribute("href", "/")
	})

	it("goes back to the app route Settings was opened from, across tab changes", async () => {
		const user = userEvent.setup()
		renderShell(true, { initialEntries: ["/context?week=1"] })

		await user.click(screen.getByTitle("Account"))
		await user.click(screen.getByRole("menuitem", { name: "Settings" }))
		await user.click(screen.getByRole("link", { name: "Audit" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/audit")

		await user.click(screen.getByRole("link", { name: "Back to Exagram" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/context?week=1")
		expect(screen.getByRole("complementary", { name: "Library sidebar" })).toBeInTheDocument()
	})
})

describe("AppShell collapsed rail and Settings", () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	it("shows the Settings sidebar even when the app sidebar is collapsed", async () => {
		const user = userEvent.setup()
		renderShell(true, { initialEntries: ["/activity"] })
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }))
		await user.click(screen.getByTitle("Account"))
		await user.click(screen.getByRole("menuitem", { name: "Settings" }))
		expect(screen.getByRole("complementary", { name: "Settings sidebar" })).toBeInTheDocument()
		expect(screen.queryByRole("complementary", { name: "Collapsed sidebar" })).not.toBeInTheDocument()

		await user.click(screen.getByRole("link", { name: "Back to Exagram" }))
		expect(screen.getByRole("complementary", { name: "Collapsed sidebar" })).toBeInTheDocument()
	})
})

describe("AppShell file drop", () => {
	beforeEach(() => {
		window.localStorage.clear()
		toast.mockClear()
		uploadOne.mockReset()
		uploadOne.mockResolvedValue({ artifactId: "a9", revisionId: "r9", status: "approved" })
	})

	const transferOf = (files: File[]) => ({
		files: Object.assign([...files], { item: (index: number) => files[index] ?? null }),
		types: ["Files"],
		getData: () => "",
	})

	const dropFiles = (target: HTMLElement, files: File[]) => {
		const dataTransfer = transferOf(files)
		fireEvent.dragEnter(target, { dataTransfer })
		fireEvent.dragOver(target, { dataTransfer })
		fireEvent.drop(target, { dataTransfer })
	}

	const notes = () => new File(["hello"], "notes.md", { type: "text/markdown" })

	it("uploads a file dropped on the sidebar straight away, with no dialog", async () => {
		renderShell(true)
		dropFiles(screen.getByRole("complementary", { name: "Library sidebar" }), [notes()])
		expect(screen.queryByRole("dialog", { name: "Upload" })).not.toBeInTheDocument()
		await waitFor(() => expect(toast).toHaveBeenCalledWith('Uploaded "notes"'))
		expect(uploadOne).toHaveBeenCalledWith(
			expect.objectContaining({ title: "notes", projectId: null, artifactId: null, note: null }),
		)
	})

	it("uploads a file dropped on the collapsed rail", async () => {
		const user = userEvent.setup()
		renderShell(true)
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }))
		dropFiles(screen.getByRole("complementary", { name: "Collapsed sidebar" }), [notes()])
		await waitFor(() => expect(uploadOne).toHaveBeenCalledTimes(1))
	})

	it("uploads every file in a drop and skips the ones Exagram cannot store", async () => {
		renderShell(true)
		const files = [notes(), new File(["x"], "tool.exe"), new File(["y"], "plan.pdf", { type: "application/pdf" })]
		dropFiles(screen.getByRole("complementary", { name: "Library sidebar" }), files)
		await waitFor(() => expect(toast).toHaveBeenCalledWith("Uploaded 2 files"))
		expect(uploadOne).toHaveBeenCalledTimes(2)
		expect(toast).toHaveBeenCalledWith(expect.stringContaining('"tool.exe" is none of those'))
	})

	it("shows where a drop lands while a file is dragged over, and clears it on drop", async () => {
		renderShell(true)
		const sidebar = screen.getByRole("complementary", { name: "Library sidebar" })
		fireEvent.dragEnter(sidebar, { dataTransfer: transferOf([notes()]) })
		expect(screen.getByText("Drop to upload")).toBeInTheDocument()
		fireEvent.drop(sidebar, { dataTransfer: transferOf([notes()]) })
		expect(screen.queryByText("Drop to upload")).not.toBeInTheDocument()
		await waitFor(() => expect(uploadOne).toHaveBeenCalledTimes(1))
	})
})
