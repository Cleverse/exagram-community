import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { Menu } from "./Menu"

const Harness = () => {
	const [anchor, setAnchor] = useState<DOMRect | null>(null)
	return (
		<>
			<button type="button" onClick={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}>
				Open
			</button>
			{anchor ? (
				<Menu
					anchor={anchor}
					ariaLabel="Things"
					onClose={() => setAnchor(null)}
					items={[
						{ label: "First", onSelect: vi.fn() },
						{ label: "Second", onSelect: vi.fn() },
						{ label: "Third", onSelect: () => setAnchor(null) },
					]}
				/>
			) : null}
		</>
	)
}

describe("Menu", () => {
	it("moves focus to the first item when it opens", async () => {
		const user = userEvent.setup()
		render(<Harness />)
		await user.click(screen.getByRole("button", { name: "Open" }))
		expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus()
	})

	it("walks the items with the arrow keys, wrapping, and jumps with Home and End", async () => {
		const user = userEvent.setup()
		render(<Harness />)
		await user.click(screen.getByRole("button", { name: "Open" }))

		await user.keyboard("{ArrowDown}")
		expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus()
		await user.keyboard("{ArrowDown}{ArrowDown}")
		expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus()
		await user.keyboard("{ArrowUp}")
		expect(screen.getByRole("menuitem", { name: "Third" })).toHaveFocus()
		await user.keyboard("{Home}")
		expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus()
		await user.keyboard("{End}")
		expect(screen.getByRole("menuitem", { name: "Third" })).toHaveFocus()
	})

	it("returns focus to the trigger when Escape closes it", async () => {
		const user = userEvent.setup()
		render(<Harness />)
		const trigger = screen.getByRole("button", { name: "Open" })
		await user.click(trigger)

		await user.keyboard("{Escape}")
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
		expect(trigger).toHaveFocus()
	})

	it("returns focus to the trigger when an item closes it", async () => {
		const user = userEvent.setup()
		render(<Harness />)
		const trigger = screen.getByRole("button", { name: "Open" })
		await user.click(trigger)

		await user.click(screen.getByRole("menuitem", { name: "Third" }))
		expect(screen.queryByRole("menu")).not.toBeInTheDocument()
		expect(trigger).toHaveFocus()
	})

	it("announces the current choice of a set and lets the arrows reach every choice", async () => {
		const user = userEvent.setup()
		const anchor = new DOMRect(0, 0, 10, 10)
		render(
			<Menu
				anchor={anchor}
				onClose={vi.fn()}
				items={[
					{ label: "Q4", checked: false, onSelect: vi.fn() },
					{ label: "Pricing", indent: true, checked: true, onSelect: vi.fn() },
				]}
			/>,
		)
		expect(screen.getByRole("menuitemradio", { name: "Pricing" })).toHaveAttribute("aria-checked", "true")
		expect(screen.getByRole("menuitemradio", { name: "Q4" })).toHaveAttribute("aria-checked", "false")
		expect(screen.getByRole("menuitemradio", { name: "Q4" })).toHaveFocus()
		await user.keyboard("{ArrowDown}")
		expect(screen.getByRole("menuitemradio", { name: "Pricing" })).toHaveFocus()
	})

	it("reads a disabled choice in place, never selects it, and the arrows skip it; the footer is plain text", async () => {
		const user = userEvent.setup()
		const anchor = new DOMRect(0, 0, 10, 10)
		const pick = vi.fn()
		render(
			<Menu
				anchor={anchor}
				onClose={vi.fn()}
				items={[
					{ label: "Invited", checked: true, onSelect: vi.fn() },
					{ label: "Workspace", checked: false, disabled: true, onSelect: pick },
					{ label: "Link", checked: false, onSelect: vi.fn() },
				]}
				footer={<p>What the link lets in</p>}
			/>,
		)
		const disabled = screen.getByRole("menuitemradio", { name: "Workspace" })
		expect(disabled).toHaveAttribute("aria-disabled", "true")
		expect(screen.getByRole("menuitemradio", { name: "Invited" })).toHaveFocus()
		await user.keyboard("{ArrowDown}")
		expect(screen.getByRole("menuitemradio", { name: "Link" })).toHaveFocus()
		await user.click(disabled)
		expect(pick).not.toHaveBeenCalled()
		expect(screen.getByRole("menu")).toHaveTextContent("What the link lets in")
		expect(screen.queryByRole("menuitem", { name: "What the link lets in" })).not.toBeInTheDocument()
	})
})
