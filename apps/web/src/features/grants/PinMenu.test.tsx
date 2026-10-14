import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { PinMenu } from "./PinMenu"

const revisions = [
	{ id: "r3", seq: 3, status: "approved" },
	{ id: "r2", seq: 2, status: "approved" },
	{ id: "r1", seq: 1, status: "approved" },
]

describe("PinMenu", () => {
	it("shows Current Revision when the grant is unpinned", () => {
		render(<PinMenu revisions={revisions} pinnedRevisionId={null} onChange={vi.fn()} disabled={false} />)
		expect(screen.getByRole("combobox", { name: "Pin" })).toHaveValue("current")
	})

	it("shows the pinned revision by its sequence number", () => {
		render(<PinMenu revisions={revisions} pinnedRevisionId="r2" onChange={vi.fn()} disabled={false} />)
		expect(screen.getByRole("combobox", { name: "Pin" })).toHaveValue("r2")
		expect(screen.getByRole("option", { name: "v2" })).toBeInTheDocument()
	})

	it("reports a chosen revision as its id", async () => {
		const onChange = vi.fn()
		render(<PinMenu revisions={revisions} pinnedRevisionId={null} onChange={onChange} disabled={false} />)
		await userEvent.selectOptions(screen.getByRole("combobox", { name: "Pin" }), "r1")
		expect(onChange).toHaveBeenCalledWith("r1")
	})

	it("reports Current Revision as null, not as a string", async () => {
		const onChange = vi.fn()
		render(<PinMenu revisions={revisions} pinnedRevisionId="r1" onChange={onChange} disabled={false} />)
		await userEvent.selectOptions(screen.getByRole("combobox", { name: "Pin" }), "current")
		expect(onChange).toHaveBeenCalledWith(null)
	})

	it("never offers a pending revision as a Pin target", () => {
		render(
			<PinMenu
				revisions={[{ id: "r4", seq: 4, status: "pending" }, ...revisions]}
				pinnedRevisionId={null}
				onChange={vi.fn()}
				disabled={false}
			/>,
		)
		expect(screen.queryByRole("option", { name: "v4" })).toBeNull()
	})
})
