import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PresentMode } from "./PresentMode"

const baseProps = () => ({
	title: "Q3 roadmap",
	folderName: "Planning",
	typeLabel: "MD",
	onExit: vi.fn(),
})

let requestFullscreen: ReturnType<typeof vi.fn>

beforeEach(() => {
	requestFullscreen = vi.fn().mockResolvedValue(undefined)
	Object.defineProperty(document.documentElement, "requestFullscreen", {
		value: requestFullscreen,
		configurable: true,
	})
})

describe("PresentMode", () => {
	it("renders the path line — folder / title TYPE — and only Exit on the right", () => {
		render(
			<PresentMode {...baseProps()}>
				<div>Body</div>
			</PresentMode>,
		)
		expect(screen.getByText("Planning")).toBeInTheDocument()
		expect(screen.getByText("Q3 roadmap")).toBeInTheDocument()
		expect(screen.getByText("MD")).toBeInTheDocument()
		expect(screen.queryByText(/of 5/)).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Previous file" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Next file" })).not.toBeInTheDocument()
		expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["ExitEsc"])
	})

	it("calls onExit when Exit is clicked", () => {
		const props = baseProps()
		render(
			<PresentMode {...props}>
				<div>Body</div>
			</PresentMode>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Exit" }))
		expect(props.onExit).toHaveBeenCalledTimes(1)
	})

	it("calls onExit on Escape, with the event defaultPrevented", () => {
		const props = baseProps()
		render(
			<PresentMode {...props}>
				<div>Body</div>
			</PresentMode>,
		)
		const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true })
		document.dispatchEvent(event)
		expect(props.onExit).toHaveBeenCalledTimes(1)
		expect(event.defaultPrevented).toBe(true)
	})

	it("never requests the browser's full screen", () => {
		render(
			<PresentMode {...baseProps()}>
				<div>Body</div>
			</PresentMode>,
		)
		expect(requestFullscreen).not.toHaveBeenCalled()
	})

	it("lays out the canvas as a flex column, so a flex-1 child (the HTML frame) can fill it", () => {
		render(
			<PresentMode {...baseProps()}>
				<div data-testid="c" className="flex-1" />
			</PresentMode>,
		)
		const canvas = screen.getByTestId("c").parentElement
		expect(canvas?.style.display).toBe("flex")
		expect(canvas?.style.flexDirection).toBe("column")
	})

	it("moves focus to Exit on mount", () => {
		render(
			<PresentMode {...baseProps()}>
				<div>Body</div>
			</PresentMode>,
		)
		expect(screen.getByRole("button", { name: "Exit" })).toHaveFocus()
	})
})
