import { ACCESS_REQUEST_NOTE_MAX } from "@exagram/api-client"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { RequestAccessCard, type RequestAccessView } from "./RequestAccessCard"

type Of<S extends RequestAccessView["state"]> = Extract<RequestAccessView, { state: S }>

const requestView = (over: Partial<Of<"request">> = {}): Of<"request"> => ({
	state: "request",
	kind: "team",
	email: "grace@example.com",
	busy: false,
	error: null,
	onSend: vi.fn(),
	onSwitchAccount: vi.fn(),
	...over,
})

const pendingView = (over: Partial<Of<"pending">> = {}): Of<"pending"> => ({
	state: "pending",
	sent: { at: Date.now() - 3 * 60_000, role: "view", note: "" },
	canRemind: false,
	busy: false,
	error: null,
	onRemind: vi.fn(),
	onCancel: vi.fn(),
	...over,
})

const approvedView = (over: Partial<Of<"approved">> = {}): Of<"approved"> => ({
	state: "approved",
	title: "Pricing FAQ",
	ownerName: "Grace",
	role: "edit",
	onOpen: vi.fn(),
	...over,
})

const card = (view: RequestAccessView) => (
	<MemoryRouter>
		<RequestAccessCard view={view} />
	</MemoryRouter>
)

describe("RequestAccessCard", () => {
	describe("request", () => {
		it("asks for access without naming the file or its Owner", () => {
			render(card(requestView()))
			expect(screen.getByRole("heading", { name: "You need access" })).toBeInTheDocument()
			expect(screen.getByText("Ask the owner for access to this file.")).toBeInTheDocument()
			expect(screen.getByText("Signed in as grace@example.com")).toBeInTheDocument()
			expect(screen.queryByText(/“|"/)).not.toBeInTheDocument()
		})

		it("offers the three roles in a Team, each with what it may do, Viewer first", async () => {
			render(card(requestView()))
			const select = screen.getByRole("combobox", { name: "Access needed" })
			expect(
				within(select)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["Viewer", "Collaborator", "Editor"])
			expect(select).toHaveValue("view")
			expect(select).toHaveAccessibleDescription("Can open and read only.")
			await userEvent.selectOptions(select, "collaborate")
			expect(select).toHaveAccessibleDescription("Can read and upload new revisions, which wait for approval.")
		})

		it("offers Viewer and Editor in a Personal Workspace, which has no Collaborator", () => {
			render(card(requestView({ kind: "personal" })))
			const select = screen.getByRole("combobox", { name: "Access needed" })
			expect(
				within(select)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["Viewer", "Editor"])
		})

		it("sends the role and the trimmed message", async () => {
			const view = requestView()
			render(card(view))
			await userEvent.selectOptions(screen.getByRole("combobox", { name: "Access needed" }), "edit")
			await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "  For the Q3 review  ")
			await userEvent.click(screen.getByRole("button", { name: "Request access" }))
			expect(view.onSend).toHaveBeenCalledWith({ role: "edit", note: "For the Q3 review" })
		})

		it("sends an empty message as no note, at Viewer by default", async () => {
			const view = requestView()
			render(card(view))
			await userEvent.click(screen.getByRole("button", { name: "Request access" }))
			expect(view.onSend).toHaveBeenCalledWith({ role: "view", note: "" })
		})

		it("stops the message at the server's limit", async () => {
			render(card(requestView()))
			const message = screen.getByRole("textbox", { name: "Message" })
			expect(message).toHaveAttribute("maxLength", String(ACCESS_REQUEST_NOTE_MAX))
			expect(message).toHaveAttribute("placeholder", "Add a message (optional)")
			await userEvent.click(message)
			await userEvent.paste("x".repeat(ACCESS_REQUEST_NOTE_MAX + 5))
			expect(message).toHaveValue("x".repeat(ACCESS_REQUEST_NOTE_MAX))
			expect(screen.getByText(`${ACCESS_REQUEST_NOTE_MAX}/${ACCESS_REQUEST_NOTE_MAX}`)).toBeInTheDocument()
		})

		it("holds the button while a request is on its way and shows why one failed", () => {
			render(card(requestView({ busy: true, error: "Too many requests" })))
			expect(screen.getByRole("button", { name: "Request access" })).toBeDisabled()
			expect(screen.getByRole("alert")).toHaveTextContent("Too many requests")
		})

		it("switches account", async () => {
			const view = requestView()
			render(card(view))
			await userEvent.click(screen.getByRole("button", { name: "Switch account" }))
			expect(view.onSwitchAccount).toHaveBeenCalledOnce()
		})
	})

	it("says only that the request was sent, and promises nothing about the file", () => {
		render(card({ state: "sent" }))
		expect(screen.getByRole("heading", { name: "Request sent" })).toBeInTheDocument()
		expect(
			screen.getByText(
				"If the owner can share this file with you, they’ll see your request. Open this page again to see their answer.",
			),
		).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Back to Exagram" })).toHaveAttribute("href", "/")
	})

	describe("pending", () => {
		it("says how long ago it was asked and keeps Send reminder off for the first 24 hours", () => {
			const view = pendingView()
			render(card(view))
			expect(screen.getByRole("heading", { name: "Request pending" })).toBeInTheDocument()
			expect(screen.getByText("You asked the owner for access to this file 3 minutes ago.")).toBeInTheDocument()
			expect(screen.getByRole("button", { name: "Send reminder" })).toBeDisabled()
			expect(screen.getByText("You can send a reminder after 24 hours.")).toBeInTheDocument()
			expect(view.onRemind).not.toHaveBeenCalled()
		})

		it("sends a reminder once a day has passed", async () => {
			const view = pendingView({
				sent: { at: Date.now() - 25 * 3_600_000, role: "view", note: "" },
				canRemind: true,
			})
			render(card(view))
			expect(screen.getByText("You asked the owner for access to this file a day ago.")).toBeInTheDocument()
			expect(screen.queryByText("You can send a reminder after 24 hours.")).not.toBeInTheDocument()
			await userEvent.click(screen.getByRole("button", { name: "Send reminder" }))
			expect(view.onRemind).toHaveBeenCalledOnce()
		})

		it("cancels the request", async () => {
			const view = pendingView()
			render(card(view))
			await userEvent.click(screen.getByRole("button", { name: "Cancel request" }))
			expect(view.onCancel).toHaveBeenCalledOnce()
		})

		it("holds both buttons while one is on its way and shows why one failed", () => {
			render(card(pendingView({ canRemind: true, busy: true, error: "Could not cancel the request" })))
			expect(screen.getByRole("button", { name: "Send reminder" })).toBeDisabled()
			expect(screen.getByRole("button", { name: "Cancel request" })).toBeDisabled()
			expect(screen.getByRole("alert")).toHaveTextContent("Could not cancel the request")
		})
	})

	it("names the file, its Owner and the role once the Owner approved, and opens it", async () => {
		const view = approvedView()
		render(card(view))
		expect(screen.getByRole("heading", { name: "You now have access to “Pricing FAQ”" })).toBeInTheDocument()
		expect(screen.getByText("Grace approved your request as Editor.")).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Open" }))
		expect(view.onOpen).toHaveBeenCalledOnce()
	})

	it.each([
		["view", "Viewer"],
		["collaborate", "Collaborator"],
		["edit", "Editor"],
	] as const)(
		"says access, not view, in the heading of a %s approval, and leaves the role to the line below",
		(role, label) => {
			render(card(approvedView({ role })))
			const heading = screen.getByRole("heading")
			expect(heading).toHaveTextContent("You now have access to “Pricing FAQ”")
			expect(heading).not.toHaveTextContent(/view/i)
			expect(screen.getByText(`Grace approved your request as ${label}.`)).toBeInTheDocument()
		},
	)

	it("calls an Owner the member cannot name “The owner”", () => {
		render(card(approvedView({ title: "", ownerName: null, role: "view" })))
		expect(screen.getByRole("heading", { name: "You now have access to this file" })).toBeInTheDocument()
		expect(screen.getByText("The owner approved your request as Viewer.")).toBeInTheDocument()
	})

	it("tells a declined request to contact the owner, naming nothing", () => {
		render(card({ state: "declined" }))
		expect(screen.getByRole("heading", { name: "Your request wasn’t approved" })).toBeInTheDocument()
		expect(screen.getByText("Contact the owner if you still need access.")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Back to Exagram" })).toBeInTheDocument()
		expect(screen.queryByRole("button")).not.toBeInTheDocument()
	})

	it("moves focus to the new state's heading when the state changes", () => {
		const { rerender } = render(card(requestView()))
		expect(screen.getByRole("heading", { name: "You need access" })).not.toHaveFocus()
		rerender(card({ state: "sent" }))
		expect(screen.getByRole("heading", { name: "Request sent" })).toHaveFocus()
	})
})
