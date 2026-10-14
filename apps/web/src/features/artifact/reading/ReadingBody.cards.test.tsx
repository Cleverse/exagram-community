import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReadingBody } from "./ReadingBody"

import { useRevisionText } from "@/features/artifact/hooks/useArtifact"

vi.mock("@/features/artifact/hooks/useArtifact", () => ({ useRevisionText: vi.fn() }))

const artifact = {
	id: "11111111-1111-4111-8111-111111111111",
	kind: "doc",
	visibleRevisionId: "22222222-2222-4222-8222-222222222222",
	title: "Pricing",
}

const TABLE = [
	"Tiers for next year.",
	"",
	"| Tier | Price | Seats |",
	"| --- | --- | --- |",
	"| Starter | $9 | 5 |",
	"| Team | [$29](https://example.com/team) | 25 |",
].join("\n")

const withText = (text: string, mime = "text/markdown", kind = "doc") => {
	vi.mocked(useRevisionText).mockReturnValue({
		data: { revisionId: artifact.visibleRevisionId, mime, text },
		isPending: false,
		isError: false,
	} as never)
	return { ...artifact, kind } as never
}

describe("ReadingBody tableMode", () => {
	beforeEach(() => vi.mocked(useRevisionText).mockReset())

	it("keeps the grid by default", () => {
		render(<ReadingBody artifact={withText(TABLE)} zoom={100} />)
		expect(screen.getByRole("table")).toBeInTheDocument()
		expect(screen.getByRole("columnheader", { name: "Price" })).toBeInTheDocument()
	})

	it("reads each row as a card titled by its first cell, with the header's names as labels", () => {
		render(<ReadingBody artifact={withText(TABLE)} zoom={100} tableMode="cards" />)
		expect(screen.queryByRole("table")).not.toBeInTheDocument()
		expect(screen.getByText("Tiers for next year.")).toBeInTheDocument()

		const starter = screen.getByText("Starter").parentElement as HTMLElement
		expect(within(starter).getByText("Price").nextSibling).toHaveTextContent("$9")
		expect(within(starter).getByText("Seats").nextSibling).toHaveTextContent("5")
		// The header row is labels, never a card of its own.
		expect(screen.queryByText("Tier")).not.toBeInTheDocument()
		expect(screen.getAllByText("Price")).toHaveLength(2)

		// A cell's own Markdown survives the move into a card.
		expect(screen.getByRole("link", { name: "$29" })).toHaveAttribute("href", "https://example.com/team")
	})

	it("turns a spreadsheet's sheets into cards too", () => {
		render(
			<ReadingBody
				artifact={withText(
					"<!-- Sheet: Q4 -->\n| Region | Revenue |\n| --- | --- |\n| EMEA | 12 |",
					"text/plain",
					"xlsx",
				)}
				zoom={100}
				tableMode="cards"
			/>,
		)
		expect(screen.getByRole("heading", { name: "Sheet Q4" })).toBeInTheDocument()
		expect(screen.getByText("Revenue").nextSibling).toHaveTextContent("12")
		expect(screen.queryByRole("table")).not.toBeInTheDocument()
	})
})
