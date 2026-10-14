import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { UnderlineTabs } from "./UnderlineTabs"

const tabs = [
	{ value: "artifacts", label: "Artifacts" },
	{ value: "chat", label: "Chat" },
	{ value: "context", label: "Context", count: 3 },
] as const

type Tab = (typeof tabs)[number]["value"]

const Harness = ({ onChange }: { onChange?: (next: Tab) => void }) => {
	const [value, setValue] = useState<Tab>("artifacts")
	return (
		<UnderlineTabs
			ariaLabel="Sections"
			tabs={[...tabs]}
			value={value}
			onChange={(next) => {
				setValue(next)
				onChange?.(next)
			}}
		/>
	)
}

describe("UnderlineTabs", () => {
	it("renders a named tablist with one selected tab", () => {
		render(<Harness />)
		expect(screen.getByRole("tablist", { name: "Sections" })).toBeInTheDocument()
		expect(screen.getAllByRole("tab")).toHaveLength(3)
		expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "false")
	})

	it("moves the selection to the clicked tab", async () => {
		const onChange = vi.fn()
		render(<Harness onChange={onChange} />)
		await userEvent.click(screen.getByRole("tab", { name: "Chat" }))
		expect(onChange).toHaveBeenCalledWith("chat")
		expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveAttribute("aria-selected", "false")
	})

	it("is one Tab stop, and the arrow keys, Home and End move and select", async () => {
		const user = userEvent.setup()
		render(<Harness />)
		expect(screen.getAllByRole("tab").map((tab) => tab.tabIndex)).toEqual([0, -1, -1])

		await user.tab()
		expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveFocus()

		await user.keyboard("{ArrowRight}")
		expect(screen.getByRole("tab", { name: "Chat" })).toHaveFocus()
		expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true")

		await user.keyboard("{End}")
		expect(screen.getByRole("tab", { name: "Context 3" })).toHaveFocus()
		await user.keyboard("{ArrowRight}")
		expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveAttribute("aria-selected", "true")
		await user.keyboard("{ArrowLeft}")
		expect(screen.getByRole("tab", { name: "Context 3" })).toHaveAttribute("aria-selected", "true")
		await user.keyboard("{Home}")
		expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveFocus()
		expect(screen.getAllByRole("tab").map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
	})

	it("shows a tab's count beside its label", () => {
		render(<Harness />)
		expect(screen.getByRole("tab", { name: "Context 3" })).toBeInTheDocument()
	})

	it("shows a badge in place of the count, read by its label", () => {
		render(
			<UnderlineTabs
				size="lg"
				tabs={[{ value: "members", label: "Members", count: 6, badge: { value: 2, label: "2 join requests" } }]}
				value="members"
				onChange={() => undefined}
			/>,
		)
		expect(screen.getByRole("tab", { name: "Members 2 join requests" })).toBeInTheDocument()
		expect(screen.queryByText("6")).not.toBeInTheDocument()
	})
})
