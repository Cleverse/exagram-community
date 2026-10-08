import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { McpSetupCardView } from "./McpSetupCard"

import { ToastProvider } from "@/components/Toast"

const SERVER_URL = "http://localhost:5173/mcp"

const writeText = vi.fn<(text: string) => Promise<void>>()

// `useToast` throws outside a `ToastProvider`; production always renders inside the one `main.tsx`
// mounts, so tests provide the same.
const renderCard = () =>
	render(
		<ToastProvider>
			<McpSetupCardView serverUrl={SERVER_URL} />
		</ToastProvider>,
	)

describe("McpSetupCardView", () => {
	beforeEach(() => {
		writeText.mockReset()
		writeText.mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
	})

	it("walks through adding the endpoint, then signing in", () => {
		renderCard()
		expect(screen.getByText("Add this endpoint to your AI client")).toBeInTheDocument()
		expect(screen.getByText("Sign in when the client asks, then try it")).toBeInTheDocument()
	})

	it("shows the server URL once, where it can be copied", () => {
		renderCard()
		expect(screen.getAllByText(SERVER_URL)).toHaveLength(1)
	})

	it("copies the server URL from the step 1 hint", async () => {
		renderCard()
		await userEvent.click(screen.getAllByRole("button", { name: "Copy" })[1]!)
		expect(writeText).toHaveBeenCalledWith(SERVER_URL)
		expect(await screen.findByText("Server URL copied.")).toBeInTheDocument()
	})

	it("copies the CLI command from step 1", async () => {
		renderCard()
		const command = `claude mcp add --transport http exagram ${SERVER_URL}`
		expect(screen.getByText(command)).toBeInTheDocument()
		await userEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]!)
		expect(writeText).toHaveBeenCalledWith(command)
		expect(await screen.findByText("Command copied.")).toBeInTheDocument()
	})

	it("has no custom connection section while personal access tokens are not issued", () => {
		renderCard()
		expect(screen.queryByText(/custom connection/i)).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Generate" })).not.toBeInTheDocument()
	})
})
