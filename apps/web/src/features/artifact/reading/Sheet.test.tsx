import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Sheet } from "./Sheet"

const sheetFontSize = (zoom: number) => {
	const { container, unmount } = render(<Sheet zoom={zoom}>body</Sheet>)
	const size = parseFloat(container.querySelector("article")!.style.fontSize)
	unmount()
	return size
}

describe("Sheet", () => {
	it("scales the whole sheet with the toolbar's zoom", () => {
		expect(sheetFontSize(200)).toBeCloseTo(sheetFontSize(100) * 2)
		expect(sheetFontSize(110)).toBeCloseTo(sheetFontSize(100) * 1.1)
	})

	it("holds only the document's content, with no eyebrow or title of its own", () => {
		const { container } = render(
			<Sheet zoom={100}>
				<p>body</p>
			</Sheet>,
		)
		expect(container.querySelector("article")?.innerHTML).toBe("<p>body</p>")
		expect(screen.queryByRole("heading")).toBeNull()
	})

	it("sits on the canvas with 20px around a 6px, borderless sheet", () => {
		const { container } = render(<Sheet zoom={100}>body</Sheet>)
		const canvas = container.firstElementChild as HTMLElement
		const sheet = canvas.firstElementChild as HTMLElement
		expect(canvas).toHaveClass("bg-ground")
		expect(canvas.style.padding).toBe("20px 20px 48px")
		expect(sheet.style.padding).toBe("36px 40px 52px")
		expect(sheet.style.borderRadius).toBe("var(--radius)")
		expect(sheet.style.border).toBe("")
		expect(sheet.style.maxWidth).toBe("800px")
	})
})
