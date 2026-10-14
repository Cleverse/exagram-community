import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { continuationInstruction } from "./continuation"
import { UseInClaude } from "./UseInClaude"

import { ToastProvider } from "@/components/Toast"

const ID = "8f1c2d3e-0000-4000-8000-000000000001"

const renderButton = () =>
	render(
		<ToastProvider>
			<UseInClaude artifactId={ID} />
		</ToastProvider>,
	)

describe("UseInClaude", () => {
	it("names the artifact ID and the tool that reads it, and nothing else of the file", () => {
		const text = continuationInstruction(ID)
		expect(text).toContain(`artifact ${ID}`)
		expect(text).toContain("artifact_read")
	})

	it("opens a popover with focus on Copy, copies the instruction and closes", async () => {
		const user = userEvent.setup()
		renderButton()
		const writeText = vi.spyOn(navigator.clipboard, "writeText")
		await user.click(screen.getByRole("button", { name: "Use in Claude" }))
		expect(screen.getByRole("dialog", { name: "Use in Claude" })).toHaveTextContent(ID)
		const copy = screen.getByRole("button", { name: "Copy" })
		expect(copy).toHaveFocus()
		await user.click(copy)
		expect(writeText).toHaveBeenCalledWith(continuationInstruction(ID))
		expect(await screen.findByText(/Copied/)).toBeInTheDocument()
		expect(screen.queryByRole("dialog", { name: "Use in Claude" })).not.toBeInTheDocument()
	})

	it("closes on Escape and returns focus to its button", async () => {
		const user = userEvent.setup()
		renderButton()
		const button = screen.getByRole("button", { name: "Use in Claude" })
		await user.click(button)
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog", { name: "Use in Claude" })).not.toBeInTheDocument()
		expect(button).toHaveFocus()
	})

	it("closes when focus moves on past it", async () => {
		const user = userEvent.setup()
		render(
			<ToastProvider>
				<UseInClaude artifactId={ID} />
				<button type="button">Share</button>
			</ToastProvider>,
		)
		await user.click(screen.getByRole("button", { name: "Use in Claude" }))
		await user.tab()
		expect(screen.getByRole("button", { name: "Share" })).toHaveFocus()
		expect(screen.queryByRole("dialog", { name: "Use in Claude" })).not.toBeInTheDocument()
	})
})
