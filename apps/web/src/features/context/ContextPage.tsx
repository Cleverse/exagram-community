import { type ReactNode, useId, useState } from "react"
import { Link, useSearchParams } from "react-router"

import { Dialog } from "@/components/Dialog"
import { useToast } from "@/components/Toast"
import { SegmentedControl } from "@/components/ui/Chip"
import { GapLine } from "@/components/ui/GapLine"
import { IconChevronRight, IconRefresh, IconSearch } from "@/components/ui/icons"
import { artifactLinkTarget } from "@/features/artifact/openArtifact"
import { buildRecap, weekFromSearch, weekLabel } from "@/features/context/recap"
import { RecapItem } from "@/features/context/RecapItem"
import { useRecapSource, weekCount } from "@/features/context/useRecapSource"
import { paths } from "@/routes/paths"

/** The 3×3 mark as it sits on the dark band (T:L2245), brighter at the centre than the sidebar's. */
const BAND_MARK = [
	"var(--color-mark-soft)",
	"var(--color-mark-mid)",
	"var(--color-mark-soft)",
	"var(--color-mark-mid)",
	"var(--color-mark-core)",
	"var(--color-mark-mid)",
	"var(--color-mark-soft)",
	"var(--color-mark-mid)",
	"var(--color-mark-soft)",
]

/** The screen's frame (T:L2237): a 1120px column, left-aligned with the other screens' 28px gutter. */
const Frame = ({ children }: { children: ReactNode }) => (
	<div data-screen-label="Context" style={{ maxWidth: 1120, padding: "20px 28px 96px" }}>
		{children}
	</div>
)

/** "Weekly recap" and its 13px subline, on the same 48px baseline row as every other screen's title. */
const Head = ({ subline }: { subline: string }) => (
	<div className="flex items-baseline" style={{ gap: 10, minHeight: 48, paddingTop: 14 }}>
		<h1
			className="font-display whitespace-nowrap"
			style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-.012em", margin: 0 }}
		>
			Weekly recap
		</h1>
		<span className="min-w-0 truncate text-muted" style={{ fontSize: 13 }}>
			{subline}
		</span>
	</div>
)

/**
 * Context (`/context?week=n`, T:L2236–2313): the week's summary on a dark band, then the week's files. The
 * week comes from the sidebar's list. The summary is written by a template from the week's own files
 * (`recap.ts`), not by a model, and the band says so; the design's sample stands in only once the library
 * has loaded empty.
 */
export const ContextPage = () => {
	const [searchParams] = useSearchParams()
	const source = useRecapSource()
	const week = weekFromSearch(searchParams)

	// Until the library and its Projects answer there is nothing to summarise: the week's dates, and no
	// sample standing in.
	if (source.status !== "ready") {
		return (
			<Frame>
				<Head subline={weekLabel(source.today, week)} />
				{source.status === "error" ? (
					<p role="alert" className="text-danger" style={{ marginTop: 16, fontSize: 14 }}>
						{`Could not load this week's artifacts. ${source.error?.message ?? ""}`.trim()}
					</p>
				) : null}
			</Frame>
		)
	}

	// A new week starts with a fresh search and every group open.
	return <WeekRecap key={week} week={week} source={source} />
}

const WeekRecap = ({ week, source }: { week: number; source: ReturnType<typeof useRecapSource> }) => {
	const toast = useToast()
	const bandTitle = useId()
	const filesTitle = useId()
	const { files, projects, rowFiles, today, now, onSample, stale, refresh } = source

	const [query, setQuery] = useState("")
	const [groupBy, setGroupBy] = useState<"project" | "day">("project")
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
	// The group the reader just opened: only that one grows open. Groups already open on load just show.
	const [revealing, setRevealing] = useState<string | null>(null)
	const [modalKey, setModalKey] = useState<string | null>(null)
	const [rebuilding, setRebuilding] = useState(false)

	const recap = buildRecap({
		files,
		projects,
		week,
		query,
		groupBy,
		openGroups,
		rowFiles,
		today,
		now,
		sample: onSample,
	})
	const linkOf = onSample ? undefined : (id: string) => paths.artifact(id)
	// The dialog reads its rows from the live groups, so it follows a rebuild and closes if its group goes.
	const modal = modalKey === null ? undefined : recap.groups.find((group) => group.key === modalKey)
	// Only the current week moves on, and only a real library can be rebuilt.
	const live = !onSample && week === 0

	const rebuild = async () => {
		setRebuilding(true)
		try {
			const next = await refresh()
			const count = weekCount(next, week, new Date())
			toast(`Summary rebuilt from ${count} ${count === 1 ? "artifact" : "artifacts"}.`)
		} catch (error) {
			toast(`Couldn't rebuild the summary. ${error instanceof Error ? error.message : ""}`.trim())
		} finally {
			setRebuilding(false)
		}
	}

	return (
		<Frame>
			<Head subline={`${recap.range} · ${recap.recapSub}`} />
			{stale ? (
				<p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
					Couldn&apos;t refresh — showing the last read.
				</p>
			) : null}

			<section
				aria-labelledby={bandTitle}
				className="grid bg-dark-panel text-ground"
				style={{ gridTemplateColumns: "minmax(0,1fr) 260px", marginTop: 16 }}
			>
				<div className="min-w-0" style={{ padding: "26px 28px 28px" }}>
					<div className="flex items-center" style={{ gap: 10 }}>
						<div
							aria-hidden
							className="grid flex-none"
							style={{ gridTemplateColumns: "repeat(3,5px)", gridTemplateRows: "repeat(3,5px)", gap: 1.5 }}
						>
							{BAND_MARK.map((background, index) => (
								<div key={index} style={{ background }} />
							))}
						</div>
						{/* A template writes this from the week's files; the label says so rather than claiming a model. */}
						<h2
							id={bandTitle}
							className="font-mono uppercase text-dark-kicker"
							style={{ fontSize: 11, letterSpacing: ".08em", fontWeight: 400, margin: 0 }}
						>
							Template summary · {recap.summaryMeta}
						</h2>
					</div>
					<p
						className="font-display text-ground"
						style={{
							fontSize: 18,
							fontWeight: 500,
							lineHeight: 1.45,
							marginTop: 14,
							maxWidth: "62ch",
							textWrap: "pretty",
						}}
					>
						{recap.headline}
					</p>
					{recap.summary.length > 0 ? (
						<ul className="flex flex-col" style={{ gap: 8, marginTop: 14, maxWidth: "68ch" }}>
							{recap.summary.map((line) => (
								<li
									key={line}
									className="flex text-dark-text-2"
									style={{ gap: 10, fontSize: 14, lineHeight: 1.6, textWrap: "pretty" }}
								>
									<span aria-hidden className="flex-none text-dark-faint">
										·
									</span>
									<span>{line}</span>
								</li>
							))}
						</ul>
					) : null}
					{recap.hasTakeaway ? (
						<div
							className="flex"
							style={{
								gap: 10,
								marginTop: 18,
								paddingTop: 14,
								borderTop: "1px solid var(--color-line-on-dark)",
								maxWidth: "68ch",
							}}
						>
							<span
								className="font-mono flex-none uppercase text-dark-kicker"
								style={{ fontSize: 11, letterSpacing: ".08em", paddingTop: 3 }}
							>
								Takeaway
							</span>
							<p className="text-dark-text" style={{ fontSize: 14, lineHeight: 1.6, margin: 0, textWrap: "pretty" }}>
								{recap.takeaway}
							</p>
						</div>
					) : null}
				</div>

				<div className="relative flex min-w-0 flex-col" style={{ padding: "26px 20px 24px" }}>
					<GapLine side="left" inset={14} tone="light" />
					<h3
						className="font-mono uppercase text-dark-faint"
						style={{ fontSize: 11, letterSpacing: ".08em", fontWeight: 400, margin: 0 }}
					>
						Sources
					</h3>
					<ul className="flex flex-col" style={{ marginTop: 8 }}>
						{recap.sources.map((item) => {
							const body = (
								<>
									{/* Brightens with its row, so the tag keeps AA contrast on the hover and focus fill. */}
									<span
										className="font-mono flex-none text-dark-faint group-hover:text-dark-text-2 group-focus-visible:text-dark-text-2"
										style={{ fontSize: 9, width: 30 }}
									>
										{item.tag}
									</span>
									<span className="truncate">{item.name}</span>
								</>
							)
							const style = { gap: 8, height: 30, padding: "0 6px", margin: "0 -6px", fontSize: 13 }
							return (
								<li key={item.id}>
									{linkOf ? (
										<Link
											to={linkOf(item.id)}
											target={artifactLinkTarget()}
											className="group flex w-full items-center text-left text-dark-text hover:bg-dark-chip hover:text-dark-text focus-visible:bg-dark-chip"
											style={style}
										>
											{body}
										</Link>
									) : (
										<div className="flex items-center text-dark-text" style={style}>
											{body}
										</div>
									)}
								</li>
							)
						})}
					</ul>
					{recap.moreSources > 0 ? (
						<div className="font-mono text-dark-faint" style={{ fontSize: 11, marginTop: 6 }}>
							+{recap.moreSources} more
						</div>
					) : null}
					<div className="flex-1" />
					{onSample ? (
						<p className="text-dark-faint" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 18 }}>
							The design&apos;s sample week. It becomes yours once your library holds files.
						</p>
					) : live ? (
						<div className="flex items-center" style={{ gap: 8, marginTop: 18 }}>
							<div
								className="font-mono whitespace-nowrap uppercase text-dark-faint"
								style={{ fontSize: 10, letterSpacing: ".08em" }}
							>
								Next · {recap.nextRecap}
							</div>
							<div
								role="progressbar"
								aria-label="How much of today has passed"
								aria-valuenow={parseInt(recap.recapProgress, 10)}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuetext={`${recap.recapProgress} of today; the week moves on ${recap.nextRecap}`}
								className="flex-1 bg-line-on-dark"
								style={{ height: 2 }}
							>
								<div className="h-full bg-dark-fill" style={{ width: recap.recapProgress }} />
							</div>
							<button
								type="button"
								title="Rebuild the summary"
								aria-label="Rebuild the summary"
								disabled={rebuilding}
								onClick={() => void rebuild()}
								className="grid flex-none place-items-center text-dark-kicker hover:bg-dark-chip hover:text-ground disabled:opacity-50"
								style={{ width: 26, height: 26 }}
							>
								<IconRefresh size={13} strokeWidth={1.6} />
							</button>
						</div>
					) : (
						<div
							className="font-mono uppercase text-dark-faint"
							style={{ fontSize: 10, letterSpacing: ".08em", marginTop: 18 }}
						>
							{recap.nextRecap}
						</div>
					)}
				</div>
			</section>

			<section aria-labelledby={filesTitle} className="flex min-w-0 flex-col bg-panel" style={{ marginTop: 28 }}>
				<h2 id={filesTitle} className="sr-only">
					Files from {recap.range}
				</h2>
				<div
					className="sticky top-0 flex flex-none items-center bg-panel"
					style={{ gap: 8, padding: "0 0 12px", borderBottom: "1px solid var(--color-pane-line)", zIndex: 1 }}
				>
					<label
						className="flex min-w-0 flex-1 items-center rounded-(--radius) bg-surface-soft"
						style={{ gap: 6, height: 34, padding: "0 10px" }}
					>
						<IconSearch size={14} className="flex-none text-muted-2" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search this week — or any file, any time"
							aria-label="Search this week — or any file, any time"
							className="min-w-0 flex-1 bg-transparent outline-none"
							style={{ border: 0, fontSize: 13, padding: "1px 2px" }}
						/>
					</label>
					<SegmentedControl
						ariaLabel="Group the recap"
						tone="light"
						options={[
							{ value: "project", label: "Project" },
							{ value: "day", label: "Day" },
						]}
						value={groupBy}
						onChange={setGroupBy}
					/>
				</div>

				{recap.recapEmpty ? (
					<p className="text-center text-muted" style={{ padding: 36 }}>
						{recap.recapEmptyMsg}
					</p>
				) : null}

				{recap.groups.map((group) => (
					<div key={group.key}>
						<h3 style={{ margin: 0 }}>
							<button
								type="button"
								aria-expanded={group.open}
								onClick={() => {
									setRevealing(group.open ? null : group.key)
									setOpenGroups((current) => ({ ...current, [group.key]: !group.open }))
								}}
								className="flex w-full items-center text-left"
								style={{ gap: 8, padding: "16px 8px 6px" }}
							>
								<IconChevronRight
									size={12}
									strokeWidth={2.4}
									className="flex-none text-muted"
									style={{ transform: group.caret, transition: "transform var(--duration-row) var(--ease-arrive)" }}
								/>
								<span style={{ fontSize: 14, fontWeight: 600 }}>{group.label}</span>
								<span className="font-mono flex-none whitespace-nowrap text-muted" style={{ fontSize: 12 }}>
									{group.count}
								</span>
							</button>
						</h3>
						{group.open ? (
							<div
								className="grid"
								style={
									revealing === group.key
										? { animation: "revealRow var(--duration-row) var(--ease-arrive)" }
										: undefined
								}
								// Once grown, a search or regroup that brings the group back just shows it.
								onAnimationEnd={(event) => {
									if (event.target === event.currentTarget) setRevealing(null)
								}}
							>
								<div className="flex min-h-0 flex-col overflow-hidden">
									{group.visibleItems.map((row) => (
										<RecapItem key={row.id} row={row} to={linkOf?.(row.id)} />
									))}
									{group.hasMore ? (
										<button
											type="button"
											onClick={() => setModalKey(group.key)}
											className="text-left text-ink hover:bg-hover"
											style={{ padding: "8px 8px 8px 28px", fontSize: 13, fontWeight: 600 }}
										>
											View {group.moreCount} more
										</button>
									) : null}
								</div>
							</div>
						) : null}
					</div>
				))}
			</section>

			{modal ? (
				<Dialog
					title={modal.label}
					onClose={() => setModalKey(null)}
					width={560}
					surface="var(--color-panel)"
					headerPadding="20px 22px"
					titleSize={19}
					bare
				>
					{modal.allItems.map((row) => (
						<RecapItem key={row.id} row={row} indent={22} to={linkOf?.(row.id)} />
					))}
				</Dialog>
			) : null}
		</Frame>
	)
}
