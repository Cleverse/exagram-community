import { type VisibleProject } from "@exagram/api-client"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ProjectPeople } from "./ProjectPeople"

const project = (overrides: Partial<VisibleProject> = {}): VisibleProject => ({
	id: "p1",
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId: null,
	publishPolicy: "auto",
	linkPreview: "metadata",
	name: "Projects",
	createdAt: new Date("2026-01-01T00:00:00Z"),
	ownerName: "Ada Lovelace",
	memberNames: ["Ida Grant", "Grace Hopper"],
	...overrides,
})

describe("ProjectPeople", () => {
	it("renders nothing when an older API leaves the people off the list", () => {
		const legacy = project()
		delete (legacy as Partial<VisibleProject>).ownerName
		delete (legacy as Partial<VisibleProject>).memberNames
		const { container } = render(<ProjectPeople project={legacy} meId="u1" onOpenShare={vi.fn()} />)
		expect(container).toBeEmptyDOMElement()
	})

	it("names the Owner, marks them as you, and counts the Owner in with the members", () => {
		render(<ProjectPeople project={project()} meId="u1" onOpenShare={vi.fn()} />)
		expect(screen.getByText("Ada Lovelace (you)")).toBeInTheDocument()
		expect(screen.getByRole("img", { name: "Ada Lovelace" })).toHaveAttribute("title", "Ada Lovelace")
		expect(screen.getByText("3 people")).toBeInTheDocument()
		expect(screen.getByTitle("Grace Hopper")).toHaveTextContent("GH")
	})

	it("drops the (you) for a reader who is not the Owner", () => {
		render(<ProjectPeople project={project({ ownerId: "u2" })} meId="u1" onOpenShare={vi.fn()} />)
		expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
		expect(screen.queryByText(/\(you\)/)).not.toBeInTheDocument()
	})

	it("folds members past three into a +N chip that names them on hover", () => {
		const memberNames = ["A One", "B Two", "C Three", "D Four", "E Five"]
		render(<ProjectPeople project={project({ memberNames })} meId="u1" onOpenShare={vi.fn()} />)
		expect(screen.getByTitle("D Four, E Five")).toHaveTextContent("+2")
		expect(screen.getByText("6 people")).toBeInTheDocument()
	})

	it("shows a Viewer the Owner alone, since the members are not theirs to read", () => {
		render(<ProjectPeople project={project({ ownerId: "u2", memberNames: null })} meId="u1" onOpenShare={vi.fn()} />)
		expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
		expect(screen.queryByText(/Access/)).not.toBeInTheDocument()
		expect(screen.queryByText(/people|Only you/)).not.toBeInTheDocument()
	})

	it("says only you for an unshared Project, and opens Share from Access", () => {
		const onOpenShare = vi.fn()
		render(<ProjectPeople project={project({ memberNames: [] })} meId="u1" onOpenShare={onOpenShare} />)
		expect(screen.getByText("Only you")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: /Access/ }))
		expect(onOpenShare).toHaveBeenCalledOnce()
	})
})
