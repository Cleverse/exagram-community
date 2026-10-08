import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ComponentProps } from "react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { ConnectionDetailDialogView } from "./ConnectionDetailDialog"

type Props = ComponentProps<typeof ConnectionDetailDialogView>

const baseProps: Props = {
	name: "Claude Desktop",
	scopeLabels: ["Can read content", "Can insert content"],
	stale: false,
	connectedLabel: "12 Aug 2026",
	lastUsedLabel: "2h",
	redactionPicker: null,
	onReconnect: vi.fn(),
	onRevoke: vi.fn(),
	onClose: vi.fn(),
	reachLabel: "Reaches every Artifact you own or hold a Grant on.",
	reconnectFolderNote: null,
	onChangeFolders: vi.fn(),
}

const renderDialog = (props: Partial<Props> = {}) =>
	render(
		<MemoryRouter>
			<ConnectionDetailDialogView {...baseProps} {...props} />
		</MemoryRouter>,
	)

describe("ConnectionDetailDialogView", () => {
	it("names the dialog after the client and lists only the capabilities it holds", () => {
		renderDialog()
		expect(screen.getByRole("dialog", { name: "Claude Desktop" })).toBeInTheDocument()
		expect(screen.getByText("Can read content")).toBeInTheDocument()
		expect(screen.queryByText("Can update content")).not.toBeInTheDocument()
	})

	it("renders the edition's redaction block above the danger zone, and nothing without one", () => {
		renderDialog({ redactionPicker: <div>Redaction block</div> })
		expect(screen.getByText("Redaction block")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument()
	})

	it("keeps the danger zone when the edition has no redaction block", () => {
		renderDialog()
		expect(screen.queryByText("Redaction for this client")).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument()
	})

	it("revokes from the danger zone", async () => {
		const onRevoke = vi.fn()
		renderDialog({ onRevoke })
		await userEvent.click(screen.getByRole("button", { name: "Revoke" }))
		expect(onRevoke).toHaveBeenCalled()
	})

	it("offers a reconnect when the client holds no Artifact scopes", () => {
		renderDialog({ stale: true, scopeLabels: [] })
		expect(screen.getByText(/it cannot reach Shares until you reconnect/)).toBeInTheDocument()
	})

	it("shows the named folder reach and opens Folder access", async () => {
		const onChangeFolders = vi.fn()
		renderDialog({
			reachLabel: "Reaches 2 selected folders and their subfolders",
			reconnectFolderNote: "Reconnecting keeps the folder limit; change folders with Folder access.",
			onChangeFolders,
		})
		expect(screen.getByText("Reaches 2 selected folders and their subfolders")).toBeInTheDocument()
		expect(
			screen.getByText("Reconnecting keeps the folder limit; change folders with Folder access."),
		).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Change" }))
		expect(onChangeFolders).toHaveBeenCalledOnce()
	})
})
