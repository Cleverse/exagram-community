import clsx from "clsx"
import { Fragment, useState } from "react"

import {
	type AuditFilter,
	type AuditRow,
	type ClientChip,
	NO_FILTER,
	applyFilter,
	chipsOf,
	filterLabel,
	isFiltered,
	isRedactionSwitchRow,
	peopleOf,
	redactionDetail,
	redactionLabel,
	rowCost,
	tokensLabel,
	totalsOf,
} from "./auditModel"
import { useAuditRows } from "./hooks/useAuditRows"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { IconChevronLeft, IconChevronRight, IconDollar, IconFilter, IconRefresh } from "@/components/ui/icons"
import { edition } from "@/edition/edition"
import { ACTION } from "@/features/audit/actionStyles"
import { costBreakdown, usd } from "@/mock/cost"
import { useLocalStore } from "@/mock/store"

export const PAGE_SIZE = 20

const columns = (costOn: boolean, redactionOn: boolean) =>
	`120px 150px 190px 100px minmax(0,1fr)${redactionOn ? " 110px" : ""} ${costOn ? "90px" : "0px"}`

/** The row as the reader may see it: with redaction off no spans were replaced, so none are priced. */
const withoutRedaction = (row: AuditRow): AuditRow => ({
	...row,
	redactedSpans: 0,
	scopeNote: row.scopeNote.replace(/ · redaction \S+$/, ""),
})

const SummaryCard = ({ dark, kicker, value }: { dark?: boolean; kicker: string; value: string }) => (
	<div
		className={clsx(
			"rounded-(--radius) px-[20px] py-[18px]",
			dark ? "bg-ink text-ground" : "border border-line-faint bg-white",
		)}
	>
		<div
			className={clsx("font-mono text-[11px] tracking-[0.14em] uppercase", dark ? "text-rail-fg-muted" : "text-muted")}
		>
			{kicker}
		</div>
		<div className="font-display mt-[6px] text-[30px] font-bold">{value}</div>
	</div>
)

const PageButton = ({
	label,
	disabled,
	onClick,
	children,
}: {
	label: string
	disabled: boolean
	onClick: () => void
	children: React.ReactNode
}) => (
	<button
		type="button"
		aria-label={label}
		disabled={disabled}
		onClick={onClick}
		className="grid h-[32px] w-[32px] place-items-center border border-line-strong bg-row-hover text-secondary-2 hover:opacity-[.85] disabled:cursor-default disabled:opacity-[.4]"
	>
		{children}
	</button>
)

const Cell = ({
	className,
	style,
	title,
	children,
}: {
	className?: string
	style?: React.CSSProperties
	title?: string
	children?: React.ReactNode
}) => (
	<div className={className} style={style} title={title}>
		{children}
	</div>
)

const selectClass =
	"h-[38px] w-full border border-line-strong bg-surface-soft px-3 text-[14px] font-medium text-secondary-2 outline-none focus:border-ink"

/** A state that replaces the whole screen: loading, forbidden, error, or a genuinely empty log. */
const AuditNote = ({ children }: { children: React.ReactNode }) => (
	<div className="mt-[24px] overflow-hidden rounded-(--radius) border border-line-faint bg-white px-[24px] py-[48px] text-center">
		{children}
	</div>
)

/** "Filter audit log" (P:2259–2284): a client and a person select; each change applies at once. */
const FilterDialog = ({
	filter,
	clients,
	people,
	onChange,
	onClose,
}: {
	filter: AuditFilter
	clients: ClientChip[]
	people: ClientChip[]
	onChange: (next: AuditFilter) => void
	onClose: () => void
}) => (
	<Dialog
		title="Filter audit log"
		onClose={onClose}
		width={440}
		surface="var(--color-panel)"
		bodyGap={18}
		helper={
			<Button variant="outline" size={36} onClick={() => onChange(NO_FILTER)} disabled={!isFiltered(filter)}>
				Clear
			</Button>
		}
		footer={
			<Button size={36} onClick={onClose}>
				Done
			</Button>
		}
	>
		<label className="flex flex-col" style={{ gap: 6 }}>
			<span className="mono-kicker">Client</span>
			<select
				className={selectClass}
				value={filter.clientId}
				onChange={(event) => onChange({ ...filter, clientId: event.target.value })}
			>
				{clients.map((option) => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</select>
		</label>
		<label className="flex flex-col" style={{ gap: 6 }}>
			<span className="mono-kicker">Person</span>
			<select
				className={selectClass}
				value={filter.person}
				onChange={(event) => onChange({ ...filter, person: event.target.value })}
			>
				{people.map((option) => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	</Dialog>
)

export const AuditView = ({
	rows,
	chips,
	filter,
	onFilterChange,
	costOn,
	onToggleCost,
	redactionOn,
	onRefresh,
	refreshing = false,
	openId,
	onToggleRow,
	page,
	onPageChange,
}: {
	rows: AuditRow[]
	/** The client options, "All clients" first. */
	chips: ClientChip[]
	filter: AuditFilter
	onFilterChange: (next: AuditFilter) => void
	costOn: boolean
	onToggleCost: () => void
	/** Off drops every redaction column, row and cost part; it comes from the api's `REDACTION_ENABLED`. */
	redactionOn: boolean
	/** Reloads the window from the Ledger; there is no polling (P: HIGH — a 90-day window is many pages). */
	onRefresh?: () => void
	refreshing?: boolean
	openId: string | null
	onToggleRow: (id: string) => void
	page: number
	onPageChange: (page: number) => void
}) => {
	const [filterOpen, setFilterOpen] = useState(false)
	const readable = redactionOn ? rows : rows.filter((row) => !isRedactionSwitchRow(row))
	// Both lists come from the rows shown, so every choice matches at least one row.
	const clients = redactionOn ? chips : chipsOf(readable)
	const people = peopleOf(readable)
	const filtered = applyFilter(readable, filter)
	const filterOn = isFiltered(filter)
	const totals = totalsOf(redactionOn ? filtered : filtered.map(withoutRedaction))
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
	// Clamp so a page that emptied under a refetch still lands on real rows.
	const current = Math.min(Math.max(page, 0), pageCount - 1)
	const start = current * PAGE_SIZE
	const visible = filtered.slice(start, start + PAGE_SIZE)
	const scopeLabel = filterOn ? filterLabel(filter, clients, people) : "all clients"

	return (
		<>
			{/* The intro reads as the tab's subline, in `SettingsPage`. */}
			<div className="flex flex-wrap items-center gap-[8px]">
				<button
					type="button"
					aria-haspopup="dialog"
					aria-label={filterOn ? `Filter: ${filterLabel(filter, clients, people)}` : "Filter"}
					onClick={() => setFilterOpen(true)}
					className={clsx(
						"flex h-[36px] items-center gap-[8px] border px-[14px] text-[14px] font-medium whitespace-nowrap hover:opacity-[.85]",
						filterOn ? "border-ink bg-ink text-white" : "border-line-strong bg-row-hover text-secondary-2",
					)}
				>
					<IconFilter size={15} aria-hidden />
					{filterLabel(filter, clients, people)}
				</button>
				<div className="min-w-[8px] flex-1" />
				<div className="text-[14px] text-muted">Last 90 days</div>
				{onRefresh ? (
					<button
						type="button"
						aria-label="Refresh"
						disabled={refreshing}
						onClick={onRefresh}
						className="flex h-[36px] items-center gap-[8px] border border-line-strong bg-row-hover px-[14px] text-[14px] font-medium text-secondary-2 hover:opacity-[.85] disabled:cursor-default disabled:opacity-[.4]"
					>
						<IconRefresh size={14} aria-hidden />
						Refresh
					</button>
				) : null}
				<button
					type="button"
					aria-pressed={costOn}
					onClick={onToggleCost}
					className={clsx(
						"flex h-[36px] items-center gap-[8px] border px-[14px] text-[14px] font-medium",
						costOn ? "border-ink bg-ink text-white" : "border-line-strong bg-row-hover text-secondary-2",
					)}
				>
					<IconDollar size={15} aria-hidden />
					{costOn ? "Hide cost" : "Show cost"}
				</button>
			</div>

			{costOn ? (
				<>
					<div className="mt-[18px] grid grid-cols-3 gap-[12px]">
						<SummaryCard dark kicker={`Cost · ${scopeLabel}`} value={totals.cost} />
						<SummaryCard kicker="Requests" value={String(totals.count)} />
						<SummaryCard kicker="Tokens served" value={totals.tokens} />
					</div>
					<p className="mt-[10px] mr-0 mb-0 ml-0 max-w-[720px] text-[14px] text-muted">
						Estimates: the API does not record usage yet, so token counts and cost are sample figures. Cost is what
						Exagram spends serving the request: {redactionOn ? "redaction inference, retrieval" : "retrieval"} and
						summarization. The client’s own model usage is billed by the client, not here.
					</p>
				</>
			) : null}

			<div className="mt-[24px] overflow-hidden rounded-(--radius) border border-line-faint bg-white">
				<div
					className="mono-col grid gap-[14px] border-b border-line bg-surface-soft px-[20px] py-[14px] tracking-[0.16em]"
					style={{ gridTemplateColumns: columns(costOn, redactionOn) }}
				>
					<Cell>Time</Cell>
					<Cell>Client</Cell>
					<Cell>User</Cell>
					<Cell>Action</Cell>
					<Cell>Document · revision</Cell>
					{redactionOn ? <Cell>Redaction</Cell> : null}
					<Cell className="text-right">{costOn ? "Cost" : ""}</Cell>
				</div>

				{filtered.length === 0 ? (
					<div className="px-[24px] py-[48px] text-center text-muted">
						{filterOn ? "No requests match this filter in the last 90 days." : "No requests in the last 90 days."}
					</div>
				) : null}

				{visible.map((row) => {
					const open = openId === row.id
					const tone = ACTION[row.action]
					const shown = redactionOn ? row : withoutRedaction(row)
					const cost = rowCost(shown)

					return (
						<Fragment key={row.id}>
							<button
								type="button"
								aria-expanded={open}
								onClick={() => onToggleRow(row.id)}
								className={clsx(
									"grid w-full cursor-pointer items-center gap-[14px] border-b border-line-pale px-[20px] py-[14px] text-left hover:bg-surface-soft",
									open ? "bg-surface-soft" : "bg-white",
								)}
								style={{ gridTemplateColumns: columns(costOn, redactionOn) }}
							>
								<Cell className="font-mono text-[13px] whitespace-nowrap text-secondary">{row.time}</Cell>
								<Cell className="flex min-w-0 items-center gap-[8px]">
									<div
										className="font-mono grid h-[24px] w-[24px] flex-none place-items-center text-[9px] font-medium"
										style={{ background: row.clientBg, color: row.clientFg }}
									>
										{row.clientInitials}
									</div>
									<div className="overflow-hidden text-[14px] text-ellipsis whitespace-nowrap">{row.client}</div>
								</Cell>
								<Cell className="flex min-w-0 items-center gap-[8px]" title={row.userEmail ?? row.user}>
									<div className="font-mono grid h-[24px] w-[24px] flex-none place-items-center bg-chip text-[9px] font-medium text-secondary">
										{row.userInitials}
									</div>
									<div className="min-w-0">
										<div className="overflow-hidden text-[14px] text-ellipsis whitespace-nowrap">{row.user}</div>
										{row.userEmail !== null ? (
											<div className="overflow-hidden text-[12px] text-ellipsis whitespace-nowrap text-muted">
												{row.userEmail}
											</div>
										) : null}
									</div>
								</Cell>
								<Cell>
									<span
										className="font-mono px-[8px] py-[4px] text-[11px] tracking-[0.1em] uppercase"
										style={{ background: tone.bg, color: tone.fg }}
									>
										{row.action}
									</span>
								</Cell>
								<Cell className="flex min-w-0 items-center gap-[10px]">
									<div
										className="font-mono grid h-[24px] w-[24px] flex-none place-items-center text-[8px] font-medium"
										style={{ background: row.iconBg, color: row.iconFg }}
									>
										{row.iconLabel}
									</div>
									<div className="min-w-0 overflow-hidden text-[14px] text-ellipsis whitespace-nowrap">{row.doc}</div>
									<div className="font-mono flex-none text-[13px] text-muted">{row.rev}</div>
								</Cell>
								{redactionOn ? (
									<Cell
										className="text-[13px] whitespace-nowrap"
										style={{ color: row.redactedSpans > 0 ? "var(--color-orange-fg)" : "var(--color-muted)" }}
									>
										{redactionLabel(row.redactedSpans, row.action)}
									</Cell>
								) : null}
								<Cell className="font-mono text-right text-[13px] whitespace-nowrap">{costOn ? usd(cost) : ""}</Cell>
							</button>

							{open ? (
								<div
									className="grid gap-[24px] border-b border-line-pale bg-surface pt-[18px] pr-[20px] pb-[22px] pl-[64px]"
									style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}
								>
									<div>
										<div className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Request</div>
										<div className="mt-[6px] text-[15px] leading-[1.55] text-body">{row.query}</div>
										<div className="mt-[10px] text-[13px] text-muted">{shown.scopeNote}</div>
									</div>
									<div
										className="grid content-start gap-x-[16px] gap-y-[6px] text-[14px]"
										style={{ gridTemplateColumns: "auto 1fr" }}
									>
										<div className="text-muted">User</div>
										<div className="min-w-0 break-words">
											{row.user}
											{row.userEmail !== null && row.userEmail !== row.user ? (
												<span className="text-muted"> · {row.userEmail}</span>
											) : null}
										</div>
										<div className="text-muted">Revision served</div>
										<div className="font-mono">
											{row.rev} · {row.revNote}
										</div>
										<div className="text-muted">Tokens</div>
										<div className="font-mono">{tokensLabel(row.tokensIn, row.tokensOut)}</div>
										{redactionOn ? (
											<>
												<div className="text-muted">Redaction</div>
												<div>{redactionDetail(row.redactedSpans)}</div>
											</>
										) : null}
										<div className="text-muted">Cost</div>
										<div className="font-mono">
											{costBreakdown(row.tokensIn, row.tokensOut, row.redactedSpans, redactionOn)}
										</div>
									</div>
								</div>
							) : null}
						</Fragment>
					)
				})}
			</div>

			{filtered.length > PAGE_SIZE ? (
				<nav aria-label="Pagination" className="mt-[14px] flex items-center justify-end gap-[8px]">
					<div className="font-mono mr-[6px] text-[13px] text-muted">
						{start + 1}–{start + visible.length} of {filtered.length}
					</div>
					<PageButton label="Previous page" disabled={current === 0} onClick={() => onPageChange(current - 1)}>
						<IconChevronLeft size={15} aria-hidden />
					</PageButton>
					<div className="font-mono text-[13px] text-secondary-2">
						{current + 1} / {pageCount}
					</div>
					<PageButton label="Next page" disabled={current === pageCount - 1} onClick={() => onPageChange(current + 1)}>
						<IconChevronRight size={15} aria-hidden />
					</PageButton>
				</nav>
			) : null}

			<p className="mt-[10px] mr-0 mb-0 ml-0 text-[14px] text-muted">
				Logs are kept for 90 days and are visible to project owners and workspace admins.
			</p>

			{filterOpen ? (
				<FilterDialog
					filter={filter}
					clients={clients}
					people={people}
					onChange={onFilterChange}
					onClose={() => setFilterOpen(false)}
				/>
			) : null}
		</>
	)
}

/** Settings → Audit: every Ledger row the reader may see. `SettingsPage` supplies the frame. */
export const AuditPage = () => {
	const state = useAuditRows()
	const redactionOn = edition.useRedactionCapability() === "enabled"
	const [costOn, setCostOn] = useLocalStore("audit.cost", false)
	const [filter, setFilter] = useState<AuditFilter>(NO_FILTER)
	const [openId, setOpenId] = useState<string | null>(null)
	const [page, setPage] = useState(0)

	if (state.status === "loading") return <AuditNote>Loading the audit log…</AuditNote>

	if (state.status === "forbidden") return <AuditNote>Only workspace admins can read the audit log.</AuditNote>

	if (state.status === "error")
		return (
			<AuditNote>
				<p role="alert" className="m-0 text-muted">
					{state.message}
				</p>
				<Button variant="outline" size={36} onClick={state.retry} className="mt-[16px]">
					Retry
				</Button>
			</AuditNote>
		)

	if (state.rows.length === 0)
		return (
			<AuditNote>
				<p className="m-0 text-muted">No client requests in the last 90 days.</p>
				<p className="mt-[6px] mb-0 text-[14px] text-muted">
					Requests from AI clients connected to this workspace will appear here.
				</p>
				<Button variant="outline" size={36} onClick={state.refresh} disabled={state.refreshing} className="mt-[16px]">
					Refresh
				</Button>
			</AuditNote>
		)

	return (
		<AuditView
			rows={state.rows}
			chips={state.chips}
			filter={filter}
			onFilterChange={(next) => {
				setFilter(next)
				setOpenId(null)
				setPage(0)
			}}
			costOn={costOn}
			onToggleCost={() => setCostOn(!costOn)}
			redactionOn={redactionOn}
			onRefresh={state.refresh}
			refreshing={state.refreshing}
			openId={openId}
			onToggleRow={(id) => setOpenId(openId === id ? null : id)}
			page={page}
			onPageChange={(next) => {
				setPage(next)
				setOpenId(null)
			}}
		/>
	)
}
