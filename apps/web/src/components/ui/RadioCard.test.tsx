import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { RadioCard } from "./RadioCard"

const options = [
	["auto", "Publish immediately", "Every upload becomes the current version the moment it lands."],
	["owner", "Owner approves every version", "Uploads wait as pending revisions until the owner approves."],
] as const

const renderGroup = (onSelect: (value: string) => void) =>
	render(
		<>
			{options.map(([value, label, description]) => (
				<RadioCard
					key={value}
					name="publish"
					value={value}
					checked={value === "auto"}
					onSelect={onSelect}
					label={label}
					description={description}
				/>
			))}
		</>,
	)

describe("RadioCard", () => {
	it("names the radio from the label alone, not the description", () => {
		renderGroup(vi.fn())
		expect(screen.getByRole("radio", { name: "Owner approves every version" })).toBeTruthy()
	})

	it("selects when the card is clicked", async () => {
		const onSelect = vi.fn()
		renderGroup(onSelect)

		await userEvent.click(screen.getByRole("radio", { name: "Owner approves every version" }))
		expect(onSelect).toHaveBeenCalledWith("owner")
	})

	it("selects when the description text is clicked", async () => {
		const onSelect = vi.fn()
		renderGroup(onSelect)

		await userEvent.click(screen.getByText("Uploads wait as pending revisions until the owner approves."))
		expect(onSelect).toHaveBeenCalledWith("owner")
	})
})
