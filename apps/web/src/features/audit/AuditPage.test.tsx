import { type ActivityEntry, type Connection, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SAMPLE_CHIPS, SAMPLE_ROWS } from "./__fixtures__/sampleAudit"
import { type AuditFilter, type AuditRow, chipsOf, type ClientChip, NO_FILTER } from "./auditModel"
import { AuditPage, AuditView, PAGE_SIZE } from "./AuditPage"

import { apiClient } from "@/config/apiClient"

const Harness = ({
	costOn = false,
	rows = SAMPLE_ROWS,
	chips = SAMPLE_CHIPS,
	redactionOn = true,
}: {
	costOn?: boolean
	rows?: AuditRow[]
	chips?: ClientChip[]
	redactionOn?: boolean
}) => {
	const [filter, setFilter] = useState<AuditFilter>(NO_FILTER)
	const [page, setPage] = useState(0)
	const [cost, setCost] = useState(costOn)
	const [openId, setOpenId] = useState<string | null>(null)

	return (
		<AuditView
			rows={rows}
			chips={chips}
			filter={filter}
			onFilterChange={(next) => {
				setFilter(next)
				setOpenId(null)
				setPage(0)
			}}
			costOn={cost}
			onToggleCost={() => setCost(!cost)}
			redactionOn={redactionOn}
			openId={openId}
			onToggleRow={(id) => setOpenId(openId === id ? null : id)}
			page={page}
			onPageChange={setPage}
		/>
	)
}

/** Enough sample rows for three pages, each with a distinct time to find it by. */
const manyRows = (count: number): AuditRow[] =>
	Array.from({ length: count }, (_, i) => {
		const row = SAMPLE_ROWS[i % SAMPLE_ROWS.length] as AuditRow
		return { ...row, id: `row-${i}`, time: `Row ${i + 1}` }
	})

describe("AuditView", () => {
	it("lists every request with its time, client and revision", () => {
		render(<Harness />)
		expect(screen.getByText("Today 14:22")).toBeInTheDocument()
		expect(screen.getAllByText("Claude Code")).not.toHaveLength(0)
		expect(screen.getByText("Yesterday 17:30")).toBeInTheDocument()
		expect(screen.getByText("Fri 15:40")).toBeInTheDocument()
	})

	it("hides cost until the toggle is pressed, then totals the filtered rows", async () => {
		const user = userEvent.setup()
		render(<Harness />)
		expect(screen.queryByText("$0.171")).not.toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Show cost" }))
		expect(screen.getByText("Cost · all clients")).toBeInTheDocument()
		expect(screen.getByText("$0.171")).toBeInTheDocument()
		expect(screen.getByText("12")).toBeInTheDocument()
		expect(screen.getByText("53.4k")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Hide cost" })).toBeInTheDocument()
		// Usage is not recorded by the API yet, so the figures say they are estimates.
		expect(screen.getByText(/^Estimates: the API does not record usage yet/)).toBeInTheDocument()
	})

	it("narrows the log to one client from the Filter dialog and re-totals it", async () => {
		const user = userEvent.setup()
		render(<Harness costOn />)

		await user.click(screen.getByRole("button", { name: "Filter" }))
		const dialog = screen.getByRole("dialog", { name: "Filter audit log" })
		await user.selectOptions(within(dialog).getByRole("combobox", { name: "Client" }), "ChatGPT")
		await user.click(within(dialog).getByRole("button", { name: "Done" }))

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Filter: ChatGPT" })).toHaveTextContent("ChatGPT")
		expect(screen.getByText("Cost · ChatGPT")).toBeInTheDocument()
		expect(screen.getByText("3")).toBeInTheDocument()
		expect(screen.queryByText("Today 14:22")).not.toBeInTheDocument()
		expect(screen.getByText("Yesterday 10:14")).toBeInTheDocument()
	})

	it("offers the people in the rows and narrows to one of them", async () => {
		const user = userEvent.setup()
		const [first, second] = SAMPLE_ROWS as [AuditRow, AuditRow]
		const rows = [
			{ ...first, id: "a", time: "Row A" },
			{ ...second, id: "b", time: "Row B", user: "Grace Hopper", userEmail: "grace@example.com" },
		]
		render(<Harness rows={rows} />)

		await user.click(screen.getByRole("button", { name: "Filter" }))
		const person = within(screen.getByRole("dialog", { name: "Filter audit log" })).getByRole("combobox", {
			name: "Person",
		})
		expect(
			within(person)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Everyone", first.user, "Grace Hopper"])
		await user.selectOptions(person, "Grace Hopper")
		expect(screen.queryByText("Row A")).not.toBeInTheDocument()
		expect(screen.getByText("Row B")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Clear" }))
		expect(screen.getByText("Row A")).toBeInTheDocument()
		await user.keyboard("{Escape}")
		expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument()
	})

	it("shows the empty note when the filter matches nothing", () => {
		render(
			<AuditView
				rows={[]}
				chips={SAMPLE_CHIPS}
				filter={{ clientId: "chatgpt", person: "all" }}
				onFilterChange={() => {}}
				costOn={false}
				onToggleCost={() => {}}
				redactionOn
				openId={null}
				onToggleRow={() => {}}
				page={0}
				onPageChange={() => {}}
			/>,
		)
		expect(screen.getByText("No requests match this filter in the last 90 days.")).toBeInTheDocument()
	})

	it("opens the detail panel of the row that was clicked", async () => {
		const user = userEvent.setup()
		render(<Harness />)

		await user.click(screen.getByRole("button", { name: /Today 14:22/ }))
		expect(screen.getByText("Read the workshop brief to list the tracks and their deliverables.")).toBeInTheDocument()
		expect(screen.getByText("Scope artifacts:read · policy applied · redaction strict")).toBeInTheDocument()
		expect(screen.getByText("v2 · current")).toBeInTheDocument()
		expect(screen.getByText("6,120 in · 0 out")).toBeInTheDocument()
		expect(screen.getByText("$0.018 · redaction $0.002 · serving $0.015")).toBeInTheDocument()
	})

	it("hides the redaction switch's own Ledger entries while redaction is off", () => {
		const base = SAMPLE_ROWS[0] as AuditRow
		const switchRow: AuditRow = {
			...base,
			id: "switch",
			doc: "AI redaction default: on",
			query: "workspace.redaction.on — served",
		}
		const { unmount } = render(<Harness rows={[switchRow, ...SAMPLE_ROWS]} redactionOn={false} />)
		expect(screen.queryByText("AI redaction default: on")).not.toBeInTheDocument()
		unmount()

		render(<Harness rows={[switchRow, ...SAMPLE_ROWS]} />)
		expect(screen.getByText("AI redaction default: on")).toBeInTheDocument()
	})

	it("offers no client whose only requests were the hidden redaction switch", async () => {
		const user = userEvent.setup()
		const base = SAMPLE_ROWS[0] as AuditRow
		const switchRow: AuditRow = {
			...base,
			id: "switch",
			clientId: "web",
			client: "Web",
			doc: "AI redaction default: on",
			query: "workspace.redaction.on — served",
		}
		const rows = [switchRow, ...SAMPLE_ROWS]
		render(<Harness rows={rows} chips={chipsOf(rows)} redactionOn={false} />)

		await user.click(screen.getByRole("button", { name: "Filter" }))
		const client = within(screen.getByRole("dialog", { name: "Filter audit log" })).getByRole("combobox", {
			name: "Client",
		})
		expect(within(client).queryByRole("option", { name: "Web" })).not.toBeInTheDocument()
	})

	it("drops every trace of redaction while redaction is off", async () => {
		const user = userEvent.setup()
		render(<Harness redactionOn={false} costOn />)

		expect(screen.queryByText("Redaction")).not.toBeInTheDocument()
		expect(screen.getByText("Estimates", { exact: false }).textContent).not.toMatch(/redaction/i)

		await user.click(screen.getByRole("button", { name: /Today 14:22/ }))
		expect(screen.queryByText("Redaction")).not.toBeInTheDocument()
		expect(screen.getByText("Scope artifacts:read · policy applied")).toBeInTheDocument()
		expect(screen.getByText("$0.015 · serving $0.015")).toBeInTheDocument()
		expect(document.body.textContent).not.toMatch(/redact/i)
	})

	it("hides pagination when every row fits on one page", () => {
		render(<Harness />)
		expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument()
	})

	it("pages through the log while totals still cover every row", async () => {
		const user = userEvent.setup()
		const count = PAGE_SIZE * 2 + 5
		render(<Harness rows={manyRows(count)} costOn />)

		expect(screen.getByText("Row 1")).toBeInTheDocument()
		expect(screen.queryByText(`Row ${PAGE_SIZE + 1}`)).not.toBeInTheDocument()
		expect(screen.getByText(`1–${PAGE_SIZE} of ${count}`)).toBeInTheDocument()
		expect(screen.getByText(String(count))).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()

		await user.click(screen.getByRole("button", { name: "Next page" }))
		expect(screen.queryByText("Row 1")).not.toBeInTheDocument()
		expect(screen.getByText(`Row ${PAGE_SIZE + 1}`)).toBeInTheDocument()
		expect(screen.getByText("2 / 3")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Next page" }))
		expect(screen.getByText(`Row ${count}`)).toBeInTheDocument()
		expect(screen.getByText(`${PAGE_SIZE * 2 + 1}–${count} of ${count}`)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()

		await user.click(screen.getByRole("button", { name: "Previous page" }))
		expect(screen.getByText("2 / 3")).toBeInTheDocument()
	})

	it("returns to the first page when the client filter changes", async () => {
		const user = userEvent.setup()
		render(<Harness rows={manyRows(PAGE_SIZE * 3)} />)

		await user.click(screen.getByRole("button", { name: "Next page" }))
		await user.click(screen.getByRole("button", { name: "Filter" }))
		await user.selectOptions(screen.getByRole("combobox", { name: "Client" }), "Claude Code")
		expect(screen.getByText(/^1 \//)).toBeInTheDocument()
	})

	it("keeps the footer note about retention", () => {
		render(<Harness />)
		expect(
			screen.getByText("Logs are kept for 90 days and are visible to project owners and workspace admins."),
		).toBeInTheDocument()
	})
})

const ME_ADMIN = {
	id: "00000000-0000-4000-8000-000000000001",
	workspaceId: "00000000-0000-4000-8000-000000000002",
	email: "admin@example.com",
	name: "Ada Admin",
	isAdmin: true,
	googleLinked: false,
	createdAt: new Date(),
	workspaceName: "Acme",
	workspaceKind: "team" as const,
	workspaces: [
		{ id: "00000000-0000-4000-8000-000000000002", kind: "team" as const, name: "Acme", role: "admin" as const },
	],
}

const ME_MEMBER = { ...ME_ADMIN, isAdmin: false }

const EMPTY_ACTIVITY = { items: [], nextCursor: null }

const renderAuditPage = () => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	return render(
		<QueryClientProvider client={queryClient}>
			<AuditPage />
		</QueryClientProvider>,
	)
}

/**
 * `useAuditRows` no longer falls back to the design's sample log: an empty or refused Ledger read
 * shows an honest state instead. These exercise the real hook against a mocked `apiClient`.
 */
describe("AuditPage", () => {
	beforeEach(() => {
		vi.spyOn(apiClient.connections, "list").mockResolvedValue([])
		vi.spyOn(apiClient.artifacts, "list").mockResolvedValue([])
	})

	// Each spy is otherwise reused (and its `.mockResolvedValueOnce` queue kept) across tests in this file.
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("shows the loading state first, with no sample flash", () => {
		vi.spyOn(apiClient.auth, "me").mockImplementation(() => new Promise(() => {}))
		vi.spyOn(apiClient.ledger, "activity").mockImplementation(() => new Promise(() => {}))
		renderAuditPage()

		expect(screen.getByText("Loading the audit log…")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument()
		expect(screen.queryByText("Claude Code")).not.toBeInTheDocument()
	})

	it("tells a non-admin the log is admin-only, with no table and no sample, and never calls the endpoint", async () => {
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(ME_MEMBER)
		const activity = vi.spyOn(apiClient.ledger, "activity").mockRejectedValue(new Error("admins only"))
		renderAuditPage()

		expect(await screen.findByText("Only workspace admins can read the audit log.")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument()
		expect(screen.queryByText("Claude Code")).not.toBeInTheDocument()
		// The Ledger only ever refuses a non-admin anyway, so the browser should not even ask it.
		expect(activity).not.toHaveBeenCalled()
	})

	it("shows an honest empty state when the admin's ledger has nothing in the last 90 days", async () => {
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(ME_ADMIN)
		vi.spyOn(apiClient.ledger, "activity").mockResolvedValue(EMPTY_ACTIVITY)
		renderAuditPage()

		expect(await screen.findByText("No client requests in the last 90 days.")).toBeInTheDocument()
		expect(
			screen.getByText("Requests from AI clients connected to this workspace will appear here."),
		).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument()
	})

	it("shows the error with its message and a retry that reloads the log", async () => {
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(ME_ADMIN)
		const activity = vi
			.spyOn(apiClient.ledger, "activity")
			.mockRejectedValueOnce(new Error("Could not load Activity"))
			.mockResolvedValue(EMPTY_ACTIVITY)
		renderAuditPage()

		const alert = await screen.findByRole("alert")
		expect(alert).toHaveTextContent("Could not load Activity")

		await userEvent.click(screen.getByRole("button", { name: "Retry" }))
		expect(await screen.findByText("No client requests in the last 90 days.")).toBeInTheDocument()
		expect(activity).toHaveBeenCalledTimes(2)
	})

	it("renders and filters real Ledger rows once the admin's activity loads", async () => {
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(ME_ADMIN)
		const connection = { id: "conn-1", name: "Claude Code" } as Connection
		const artifact = { id: "art-1", title: "Evaluation Rubric", kind: "doc", revisionSeq: 1 } as VisibleArtifact
		const entries: ActivityEntry[] = [
			{
				callId: "call-1",
				principalKind: "connection",
				principalId: "conn-1",
				surface: "mcp",
				action: "artifact_read",
				status: "delivered",
				startedAt: new Date(Date.now() - 60_000),
				deliveredAt: null,
				artifactId: "art-1",
				revisionId: "rev-1",
				outcome: "served",
				reason: null,
				actor: { userId: "user-2", name: "Grace Hopper", email: "grace@example.com" },
				subject: null,
			},
			{
				callId: "call-2",
				principalKind: "user",
				principalId: "user-3",
				surface: "web",
				action: "project_list",
				status: "delivered",
				startedAt: new Date(Date.now() - 120_000),
				deliveredAt: null,
				artifactId: null,
				revisionId: null,
				outcome: "served",
				reason: null,
				actor: { userId: "user-3", name: "Ada Admin", email: "admin@example.com" },
				subject: null,
			},
		]
		vi.spyOn(apiClient.ledger, "activity").mockResolvedValue({ items: entries, nextCursor: null })
		vi.spyOn(apiClient.connections, "list").mockResolvedValue([connection])
		vi.spyOn(apiClient.artifacts, "list").mockResolvedValue([artifact])

		renderAuditPage()

		expect(await screen.findByText("Evaluation Rubric")).toBeInTheDocument()
		expect(screen.getByText("Grace Hopper")).toBeInTheDocument()
		expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0)
		expect(screen.getByText("Web")).toBeInTheDocument()

		await userEvent.click(screen.getByRole("button", { name: "Filter" }))
		const dialog = screen.getByRole("dialog", { name: "Filter audit log" })
		await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Client" }), "Claude Code")
		await userEvent.click(within(dialog).getByRole("button", { name: "Done" }))

		expect(screen.queryByText("Web")).not.toBeInTheDocument()
		expect(screen.getByText("Evaluation Rubric")).toBeInTheDocument()
	})

	it("reloads the log from a Refresh button, not from polling", async () => {
		const user = userEvent.setup()
		vi.spyOn(apiClient.auth, "me").mockResolvedValue(ME_ADMIN)
		const activity = vi.spyOn(apiClient.ledger, "activity").mockResolvedValue(EMPTY_ACTIVITY)
		renderAuditPage()

		// findByRole first, on real timers: fake timers would also stall Testing Library's own polling.
		expect(await screen.findByRole("button", { name: "Refresh" })).toBeInTheDocument()
		expect(activity).toHaveBeenCalledTimes(1)

		// No `refetchInterval`: sitting on the page, even well past the old 15s poll, fetches nothing more.
		vi.useFakeTimers()
		await vi.advanceTimersByTimeAsync(60_000)
		vi.useRealTimers()
		expect(activity).toHaveBeenCalledTimes(1)

		await user.click(screen.getByRole("button", { name: "Refresh" }))
		await waitFor(() => expect(activity).toHaveBeenCalledTimes(2))
	})
})
