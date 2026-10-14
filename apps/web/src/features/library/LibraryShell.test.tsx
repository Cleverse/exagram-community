import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LibraryShell } from "./LibraryShell"

import { LIST_MIN_WIDTH } from "@/features/library/hooks/useListWidth"

describe("LibraryShell", () => {
	it("renders the list beside the preview slot", () => {
		render(
			<LibraryShell preview={<div>preview pane</div>}>
				<div>list column</div>
			</LibraryShell>,
		)
		expect(screen.getByText("list column")).toBeInTheDocument()
		expect(screen.getByText("preview pane")).toBeInTheDocument()
	})

	it("floors the list column at the shared LIST_MIN_WIDTH", () => {
		render(
			<LibraryShell>
				<div>list column</div>
			</LibraryShell>,
		)
		expect(screen.getByText("list column").parentElement).toHaveStyle({ minWidth: `${LIST_MIN_WIDTH}px` })
	})

	it("sizes the list beside an open pane and lets it fill without one", () => {
		const { rerender } = render(
			<LibraryShell listWidth={420} preview={<div>preview pane</div>}>
				<div>list column</div>
			</LibraryShell>,
		)
		expect(screen.getByText("list column").parentElement).toHaveStyle({ flex: "0 1 420px" })

		rerender(
			<LibraryShell listWidth={420}>
				<div>list column</div>
			</LibraryShell>,
		)
		expect(screen.getByText("list column").parentElement).toHaveStyle({ flex: "1 1 0" })
	})
})
