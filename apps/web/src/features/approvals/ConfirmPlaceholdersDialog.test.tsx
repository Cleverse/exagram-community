import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ConfirmPlaceholdersDialog } from "./ConfirmPlaceholdersDialog"

describe("ConfirmPlaceholdersDialog", () => {
	it("names every placeholder type in the Revision", () => {
		render(<ConfirmPlaceholdersDialog types={["EMAIL", "PHONE"]} onConfirm={vi.fn()} onCancel={vi.fn()} />)
		expect(screen.getByText("[EMAIL]")).toBeInTheDocument()
		expect(screen.getByText("[PHONE]")).toBeInTheDocument()
	})

	it("says plainly what Approval will do", () => {
		render(<ConfirmPlaceholdersDialog types={["EMAIL"]} onConfirm={vi.fn()} onCancel={vi.fn()} />)
		expect(
			screen.getByText(/the placeholders will become the content in place of the real values/i),
		).toBeInTheDocument()
	})

	it("confirms only on the explicit second step", async () => {
		const onConfirm = vi.fn()
		render(<ConfirmPlaceholdersDialog types={["EMAIL"]} onConfirm={onConfirm} onCancel={vi.fn()} />)
		expect(onConfirm).not.toHaveBeenCalled()
		await userEvent.click(screen.getByRole("button", { name: /Approve anyway/i }))
		expect(onConfirm).toHaveBeenCalledTimes(1)
	})
})
