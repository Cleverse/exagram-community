import { type VisibleArtifact } from "@exagram/api-client"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { fileMeta, MobileFileRow, MobileProjectRow } from "./rows"

import { renderMobile } from "@/test/mobile"

const now = new Date(2026, 8, 28, 12)

const artifact = (over: Partial<VisibleArtifact> = {}): VisibleArtifact =>
	({
		id: "a1",
		projectId: "p1",
		kind: "pdf",
		title: "Board pack",
		revisionSeq: 3,
		updatedAt: new Date(2026, 8, 27, 9),
		...over,
	}) as VisibleArtifact

describe("fileMeta", () => {
	it("reads Project · vN · age, and No project outside one", () => {
		expect(fileMeta(artifact(), "Q4", now)).toBe("Q4 · v3 · yesterday")
		expect(fileMeta(artifact({ updatedAt: now }), null, now)).toBe("No folder · v3 · today")
	})
})

describe("MobileFileRow", () => {
	it("links to the file, marks a waiting Revision, and opens the File drawer from More", async () => {
		const user = userEvent.setup()
		const onMore = vi.fn()
		renderMobile(<MobileFileRow artifact={artifact()} projectName="Q4" pending onMore={onMore} />)
		expect(screen.getByRole("link", { name: /Board pack/ })).toHaveAttribute("href", "/artifacts/a1")
		expect(screen.getByLabelText("Waiting for approval")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "More actions for Board pack" }))
		expect(onMore).toHaveBeenCalledOnce()
	})
})

describe("MobileProjectRow", () => {
	it("links to the Project with its count", () => {
		renderMobile(<MobileProjectRow projectId="p1" name="Q4" count={7} shared />)
		const link = screen.getByRole("link", { name: /Q4/ })
		expect(link).toHaveAttribute("href", "/projects/p1")
		expect(link).toHaveTextContent("7")
	})
})
