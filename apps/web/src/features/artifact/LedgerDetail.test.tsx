import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LedgerDetail } from "./LedgerDetail"

const baseRow = {
	callId: "c1",
	principalKind: "user" as const,
	principalId: "11111111-2222-3333-4444-555555555555",
	surface: "web" as const,
	action: "read",
	status: "delivered" as const,
	startedAt: new Date("2026-01-01T10:00:00Z"),
	deliveredAt: new Date("2026-01-01T10:00:01Z"),
	artifactId: "a1",
	revisionId: "r1",
	outcome: "served" as const,
	reason: null,
}

describe("LedgerDetail", () => {
	it("marks the served revision current when it matches the artifact's current revision", () => {
		render(<LedgerDetail row={{ ...baseRow, revisionId: "r1" }} revisionLabel={() => "v3"} currentRevisionId="r1" />)
		expect(screen.getByText("v3 · current")).toBeInTheDocument()
	})

	it("marks the served revision superseded when it does not match current", () => {
		render(<LedgerDetail row={{ ...baseRow, revisionId: "r0" }} revisionLabel={() => "v2"} currentRevisionId="r1" />)
		expect(screen.getByText("v2 · superseded")).toBeInTheDocument()
	})

	it("shows the withheld reason only when the outcome is withheld", () => {
		render(
			<LedgerDetail
				row={{ ...baseRow, outcome: "withheld", reason: "no Grant" }}
				revisionLabel={() => "v1"}
				currentRevisionId="r1"
			/>,
		)
		expect(screen.getByText("Withheld because")).toBeInTheDocument()
		expect(screen.getByText("no Grant")).toBeInTheDocument()
	})

	it("shows a dash for a null revision and omits the withheld reason when served", () => {
		render(
			<LedgerDetail row={{ ...baseRow, revisionId: null }} revisionLabel={() => "unused"} currentRevisionId="r1" />,
		)
		expect(screen.getByText("—")).toBeInTheDocument()
		expect(screen.queryByText("Withheld because")).toBeNull()
	})

	it("shows a plain label with no current/superseded suffix when the caller has no notion of current", () => {
		render(<LedgerDetail row={{ ...baseRow, revisionId: "r1" }} revisionLabel={() => "r1234567"} />)
		expect(screen.getByText("r1234567")).toBeInTheDocument()
	})
})
