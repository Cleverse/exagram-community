import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { UnderlineNav } from "./UnderlineNav"

describe("UnderlineNav", () => {
	it("renders a named navigation of links with the current one marked", () => {
		render(
			<MemoryRouter>
				<UnderlineNav
					ariaLabel="Sections"
					items={[
						{ to: "/activity", label: "Artifacts", active: true },
						{ to: "/context", label: "Context", active: false },
					]}
				/>
			</MemoryRouter>,
		)
		const nav = screen.getByRole("navigation", { name: "Sections" })
		expect(nav).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Artifacts" })).toHaveAttribute("aria-current", "page")
		expect(screen.getByRole("link", { name: "Context" })).toHaveAttribute("href", "/context")
		expect(screen.getByRole("link", { name: "Context" })).not.toHaveAttribute("aria-current")
	})

	it("underlines only the current scope tab, keeping a transparent underline on the rest", () => {
		render(
			<MemoryRouter>
				<UnderlineNav
					ariaLabel="Library scope"
					variant="scope"
					items={[
						{ to: "/", label: "All", active: true, count: 12 },
						{ to: "/mine", label: "My uploads", active: false, count: 3 },
					]}
				/>
			</MemoryRouter>,
		)
		const all = screen.getByRole("link", { name: "All 12" })
		const mine = screen.getByRole("link", { name: "My uploads 3" })
		expect(all).toHaveAttribute("aria-current", "page")
		expect(all.style.boxShadow).toBe("inset 0 -2px 0 var(--color-ink)")
		expect(mine.style.boxShadow).toBe("inset 0 -2px 0 transparent")
		expect([all.style.fontWeight, mine.style.fontWeight]).toEqual(["600", "500"])
	})
})
