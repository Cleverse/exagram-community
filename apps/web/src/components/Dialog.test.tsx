import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { Dialog } from "./Dialog"

describe("Dialog", () => {
	it("calls onClose on Escape", async () => {
		const onClose = vi.fn()
		render(
			<Dialog title="A dialog" onClose={onClose}>
				content
			</Dialog>,
		)
		await userEvent.keyboard("{Escape}")
		expect(onClose).toHaveBeenCalled()
	})

	it("calls onClose on a scrim click but not on a click inside the dialog", async () => {
		const onClose = vi.fn()
		render(
			<Dialog title="A dialog" onClose={onClose}>
				<button type="button">inside</button>
			</Dialog>,
		)

		await userEvent.click(screen.getByText("inside"))
		expect(onClose).not.toHaveBeenCalled()

		await userEvent.click(screen.getByRole("dialog", { name: "A dialog" }).parentElement!)
		expect(onClose).toHaveBeenCalled()
	})

	it("keeps focus in a field when the parent re-renders with a new onClose", async () => {
		const Host = () => {
			const [count, setCount] = useState(0)
			return (
				<Dialog title="A dialog" onClose={() => setCount(count)}>
					<input aria-label="Name" onChange={() => setCount((value) => value + 1)} />
				</Dialog>
			)
		}
		render(<Host />)
		const input = screen.getByRole("textbox", { name: "Name" })
		await userEvent.click(input)
		await userEvent.keyboard("abc")
		expect(input).toHaveFocus()
		expect(input).toHaveValue("abc")
	})

	describe("focus trap", () => {
		const renderTrap = () =>
			render(
				<>
					<button type="button">behind</button>
					<Dialog title="A dialog" onClose={vi.fn()}>
						<button type="button">first</button>
						<button type="button" disabled>
							skipped
						</button>
						<input aria-label="middle" />
						<button type="button">last</button>
					</Dialog>
				</>,
			)

		it("wraps Tab from the last control to the first, and Shift+Tab back, never reaching the page behind", async () => {
			const user = userEvent.setup()
			renderTrap()
			const [close, first, middle, last] = [
				screen.getByRole("button", { name: "Close" }),
				screen.getByRole("button", { name: "first" }),
				screen.getByRole("textbox", { name: "middle" }),
				screen.getByRole("button", { name: "last" }),
			]
			close.focus()
			await user.tab()
			expect(first).toHaveFocus()
			await user.tab()
			expect(middle).toHaveFocus()
			await user.tab()
			expect(last).toHaveFocus()
			await user.tab()
			expect(close).toHaveFocus()
			await user.tab({ shift: true })
			expect(last).toHaveFocus()
			expect(screen.getByRole("button", { name: "behind" })).not.toHaveFocus()
		})

		it.each([
			{ edge: "last", checked: "one", key: "{Tab}" },
			{ edge: "first", checked: "two", key: "{Shift>}{Tab}{/Shift}" },
		])(
			"wraps from a radio group's checked radio when it is the dialog's $edge stop, not past the unchecked one",
			async ({ checked, key }) => {
				const user = userEvent.setup()
				render(
					<Dialog ariaLabel="A dialog" onClose={vi.fn()}>
						<input type="radio" name="choice" aria-label="one" defaultChecked={checked === "one"} />
						<input type="radio" name="choice" aria-label="two" defaultChecked={checked === "two"} />
					</Dialog>,
				)
				const radio = screen.getByRole("radio", { name: checked })
				radio.focus()
				await user.keyboard(key)
				expect(radio).toHaveFocus()
			},
		)

		it("brings focus back inside when the control that held it unmounts", async () => {
			const user = userEvent.setup()
			renderTrap()
			;(document.activeElement as HTMLElement | null)?.blur()
			await user.tab()
			expect(screen.getByRole("dialog", { name: "A dialog" })).toContainElement(document.activeElement as HTMLElement)
		})

		it("leaves Tab alone while focus sits in something outside the dialog, such as a menu over it", async () => {
			const user = userEvent.setup()
			render(
				<>
					<Dialog title="A dialog" onClose={vi.fn()}>
						<button type="button">inside</button>
					</Dialog>
					<div role="menu">
						<button type="button" role="menuitem">
							item
						</button>
						<button type="button" role="menuitem">
							other
						</button>
					</div>
				</>,
			)
			screen.getByRole("menuitem", { name: "item" }).focus()
			await user.tab()
			expect(screen.getByRole("menuitem", { name: "other" })).toHaveFocus()
		})

		it("traps only the topmost of two dialogs", async () => {
			const user = userEvent.setup()
			render(
				<>
					<Dialog title="Below" onClose={vi.fn()}>
						<button type="button">below</button>
					</Dialog>
					<Dialog title="Above" onClose={vi.fn()}>
						<button type="button">above</button>
					</Dialog>
				</>,
			)
			const above = screen.getByRole("dialog", { name: "Above" })
			const stops = [...above.querySelectorAll<HTMLElement>("button")]
			stops[stops.length - 1]?.focus()
			await user.tab()
			expect(above).toContainElement(document.activeElement as HTMLElement)
		})
	})

	it("leaves a child's autoFocus in place", () => {
		render(
			<Dialog title="A dialog" onClose={vi.fn()}>
				<input aria-label="Name" autoFocus />
			</Dialog>,
		)
		expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus()
	})
})
