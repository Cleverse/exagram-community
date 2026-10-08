import { type Project } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectRulesChip } from "./ProjectRulesChip"

import { QueryKeys } from "@/config/queryKeys"
import { clearMock, writeMock } from "@/mock/store"
import { meActingIn, sessionIn } from "@/test/workspaces"

const project: Project = {
	id: "p1",
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId: null,
	publishPolicy: "manual",
	linkPreview: "metadata",
	name: "Q4",
	createdAt: new Date("2026-01-01T00:00:00Z"),
}

const renderChip = (onEdit = vi.fn(), me: object = sessionIn("team", "w1")) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), me)
	return render(
		<QueryClientProvider client={queryClient}>
			<ProjectRulesChip project={project} onEdit={onEdit} />
		</QueryClientProvider>,
	)
}

describe("ProjectRulesChip", () => {
	beforeEach(() => {
		clearMock("project.p1")
	})

	it("opens the rules a client follows, with the real publish policy", async () => {
		const user = userEvent.setup()
		renderChip()
		const chip = screen.getByRole("button", { name: /Project rules/ })
		expect(chip).toHaveAttribute("aria-haspopup", "dialog")
		expect(chip).toHaveAttribute("aria-expanded", "false")

		await user.click(chip)
		const card = screen.getByRole("dialog", { name: "Project rules" })
		expect(within(card).getByText("No policy — clients read this project with workspace defaults")).toBeInTheDocument()
		expect(within(card).getByText("Owner-only overwrite")).toBeInTheDocument()
		expect(within(card).getByText("Manual approval only")).toBeInTheDocument()
		// Policy and overwrite live in this browser only; the publish policy is the Project's own.
		expect(within(card).getByText("Policy · Saved in this browser")).toBeInTheDocument()
		expect(within(card).getByText("Overwrite · Saved in this browser")).toBeInTheDocument()
		expect(within(card).getByText("Published version")).toBeInTheDocument()
		expect(chip).toHaveAttribute("aria-expanded", "true")
	})

	it("shows the saved policy and overwrite setting, and counts the policy as a rule", async () => {
		const user = userEvent.setup()
		writeMock("project.p1", { policy: "Cite the board pack.", overwrite: true })
		renderChip()
		expect(screen.getByRole("button", { name: /Project rules/ })).toHaveTextContent("3")

		await user.click(screen.getByRole("button", { name: /Project rules/ }))
		expect(screen.getByText("Cite the board pack.")).toBeInTheDocument()
		expect(screen.getByText("Editors can overwrite")).toBeInTheDocument()
	})

	it("follows the Project's own Workspace, not the one the session is in", async () => {
		const user = userEvent.setup()
		writeMock("project.p1", { policy: "Cite the file.", overwrite: true })
		renderChip(vi.fn(), meActingIn({ id: "w2", kind: "personal" }, [{ id: "w1", kind: "team" }]))
		await user.click(screen.getByRole("button", { name: /Project rules/ }))
		expect(screen.getByRole("dialog", { name: "Project rules" })).toHaveTextContent("Published version")
	})

	it("shows only the policy in a Personal Workspace, which has no overwrite or approvals", async () => {
		const user = userEvent.setup()
		writeMock("project.p1", { policy: "Cite the board pack.", overwrite: true })
		renderChip(vi.fn(), sessionIn("personal", "w1"))
		expect(screen.getByRole("button", { name: /Project rules/ })).toHaveTextContent("1")

		await user.click(screen.getByRole("button", { name: /Project rules/ }))
		expect(screen.getByText("Cite the board pack.")).toBeInTheDocument()
		expect(screen.queryByText("Editors can overwrite")).not.toBeInTheDocument()
		expect(screen.queryByText("Published version")).not.toBeInTheDocument()
	})

	it("hands Edit settings to the settings dialog and closes; Escape and Close close it too", async () => {
		const user = userEvent.setup()
		const onEdit = vi.fn()
		renderChip(onEdit)
		const chip = screen.getByRole("button", { name: /Project rules/ })

		await user.click(chip)
		await user.keyboard("{Escape}")
		expect(screen.queryByRole("dialog", { name: "Project rules" })).not.toBeInTheDocument()
		expect(chip).toHaveFocus()

		await user.click(chip)
		const dialog = screen.getByRole("dialog", { name: "Project rules" })
		await user.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!)
		expect(screen.queryByRole("dialog", { name: "Project rules" })).not.toBeInTheDocument()
		expect(chip).toHaveFocus()

		await user.click(chip)
		await user.click(screen.getByRole("button", { name: "Edit settings" }))
		expect(onEdit).toHaveBeenCalled()
		expect(screen.queryByRole("dialog", { name: "Project rules" })).not.toBeInTheDocument()
	})
})
