import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { Checkbox } from "./Checkbox"

const Row = ({ disabled = false }: { disabled?: boolean }) => {
	const [on, setOn] = useState(false)
	return (
		<label>
			<Checkbox checked={on} onChange={setOn} disabled={disabled} />
			Grace Hopper
		</label>
	)
}

describe("Checkbox", () => {
	it("is named by the label around it and toggles when the label text is clicked", async () => {
		render(<Row />)
		const box = screen.getByRole("checkbox", { name: "Grace Hopper" })
		expect(box).not.toBeChecked()

		await userEvent.click(screen.getByText("Grace Hopper"))
		expect(box).toBeChecked()
		await userEvent.click(box)
		expect(box).not.toBeChecked()
	})

	it("toggles from the keyboard with Space", async () => {
		render(<Row />)
		await userEvent.tab()
		expect(screen.getByRole("checkbox")).toHaveFocus()
		await userEvent.keyboard(" ")
		expect(screen.getByRole("checkbox")).toBeChecked()
	})

	it("takes its name from `ariaLabel` when nothing wraps it", () => {
		render(<Checkbox checked onChange={() => {}} ariaLabel="Select all" />)
		expect(screen.getByRole("checkbox", { name: "Select all" })).toBeChecked()
	})

	it("does not toggle while disabled", async () => {
		render(<Row disabled />)
		await userEvent.click(screen.getByRole("checkbox"))
		expect(screen.getByRole("checkbox")).not.toBeChecked()
	})
})
