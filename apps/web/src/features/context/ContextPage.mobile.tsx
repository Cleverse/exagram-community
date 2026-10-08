import clsx from "clsx"
import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { MobileScreen, SectionLabel } from "@/components/mobile/primitives"
import { FolderGlyph } from "@/components/mobile/rows"
import { useToast } from "@/components/Toast"
import { IconRefresh, IconSearch } from "@/components/ui/icons"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { useMe } from "@/features/auth/hooks/useMe"
import {
	buildRecap,
	type RecapFile,
	type RecapGroup,
	RECAP_WEEKS,
	weekFromSearch,
	weekLabel,
} from "@/features/context/recap"
import { useRecapSource, weekCount } from "@/features/context/useRecapSource"
import { paths } from "@/routes/paths"

const TAGS = ["This week", "Last week"]

type Source = ReturnType<typeof useRecapSource>

/**
 * The week switcher (W:L404–407): one 34px chip per week the desktop sidebar lists, newest first, the current
 * one dark. This and last week carry their name with the range beside it at 60%; older weeks are their range.
 * The week lives in `?week=`, as on desktop, and a pick replaces the address rather than stacking history.
 */
const WeekChips = ({ week, today }: { week: number; today: Date }) => {
	const navigate = useNavigate()
	return (
		<div
			role="tablist"
			aria-label="Week"
			className="flex flex-none overflow-x-auto"
			style={{ gap: 8, padding: "12px 16px 10px" }}
		>
			{Array.from({ length: RECAP_WEEKS }, (_, index) => {
				const on = index === week
				const tag = TAGS[index]
				const range = weekLabel(today, index)
				return (
					<button
						key={index}
						type="button"
						role="tab"
						aria-selected={on}
						onClick={() => void navigate(paths.contextWeek(index), { replace: true })}
						className={clsx(
							"flex flex-none items-center whitespace-nowrap",
							on ? "bg-ink text-white" : "bg-row-selected text-body active:bg-press",
						)}
						style={{ height: 34, padding: "0 12px", gap: 7, fontSize: 14, fontWeight: 500 }}
					>
						{tag ?? range}
						{tag ? <span style={{ fontSize: 12, opacity: 0.6 }}>{range}</span> : null}
					</button>
				)
			})}
		</div>
	)
}

/**
 * Weekly recap (`/context`, W:L403–455, README §6), a root screen under the top bar: the week switcher, the
 * week's summary on a dark card, its sources, "Search every recap", and the week's updates grouped by
 * Project. The summary is desktop's template (`recap.ts`), labelled as one rather than as an AI summary.
 */
export default function ContextPageMobile() {
	const [searchParams] = useSearchParams()
	const source = useRecapSource()
	const week = weekFromSearch(searchParams)

	return (
		<MobileScreen
			label="Weekly recap"
			header={<WeekChips week={week} today={source.today} />}
			bodyStyle={{ paddingBottom: 32 }}
		>
			{source.status === "ready" ? (
				// A new week starts with a fresh search and every group folded back.
				<WeekRecap key={week} week={week} source={source} />
			) : source.status === "error" ? (
				<p role="alert" className="text-danger" style={{ margin: "4px 16px", fontSize: 14 }}>
					{`Could not load this week's artifacts. ${source.error?.message ?? ""}`.trim()}
				</p>
			) : (
				<SkeletonStatus label="Loading this week…">
					<div className="bg-dark-panel" style={{ margin: "0 12px", borderRadius: 10, padding: "18px 18px 16px" }}>
						<Skeleton width="40%" height={10} style={{ opacity: 0.2 }} />
						<Skeleton width="90%" height={16} style={{ marginTop: 14, opacity: 0.2 }} />
						<Skeleton width="70%" height={16} style={{ marginTop: 8, opacity: 0.2 }} />
					</div>
				</SkeletonStatus>
			)}
		</MobileScreen>
	)
}

const WeekRecap = ({ week, source }: { week: number; source: Source }) => {
	const toast = useToast()
	const me = useMe()
	const { files, projects, rowFiles, today, now, onSample, stale, refresh } = source
	const [query, setQuery] = useState("")
	const [expanded, setExpanded] = useState<Record<string, boolean>>({})
	const [rebuilding, setRebuilding] = useState(false)

	// Every group stays open on a phone: the list is the page, and a group folds only its overflow.
	const recap = buildRecap({
		files,
		projects,
		week,
		query,
		groupBy: "project",
		openGroups: {},
		rowFiles,
		today,
		now,
		sample: onSample,
	})
	const byId = new Map((rowFiles ?? files).map((file) => [file.id, file]))
	const projectIds = new Set(projects.map((project) => project.id))
	// Only the current week of a real library moves on, and only it can be rebuilt (as on desktop).
	const live = !onSample && week === 0
	const searching = query.trim() !== ""
	// A search always yields its one "Search results" group, so an empty one is the empty state too.
	const nothing = recap.recapEmpty || recap.groups.every((group) => group.allItems.length === 0)

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
		<>
			{stale ? (
				<p className="text-muted" style={{ fontSize: 13, margin: "0 16px 8px" }}>
					Couldn&apos;t refresh — showing the last read.
				</p>
			) : null}

			<section
				aria-label="Summary"
				className="bg-dark-panel text-white"
				style={{ margin: "0 12px", borderRadius: 10, padding: "18px 18px 16px" }}
			>
				{/* A template writes this from the week's files; the label says so rather than claiming a model. */}
				<h2
					className="font-mono m-0 uppercase text-dark-kicker"
					style={{ fontSize: 10.5, letterSpacing: ".08em", fontWeight: 400 }}
				>
					Template summary · {recap.summaryMeta}
				</h2>
				<p
					className="m-0"
					style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.4, marginTop: 10, textWrap: "pretty" }}
				>
					{recap.headline}
				</p>
				{recap.summary.length > 0 ? (
					<ul className="m-0 flex list-none flex-col p-0" style={{ gap: 8, marginTop: 14 }}>
						{recap.summary.map((line) => (
							<li key={line} className="flex text-dark-text-2" style={{ gap: 10, fontSize: 14, lineHeight: 1.5 }}>
								<span
									aria-hidden
									className="flex-none bg-dark-faint"
									style={{ width: 4, height: 4, borderRadius: "50%", marginTop: 9 }}
								/>
								<span>{line}</span>
							</li>
						))}
					</ul>
				) : null}
				{recap.hasTakeaway ? (
					<p
						className="m-0"
						style={{
							marginTop: 14,
							paddingTop: 12,
							borderTop: "1px solid var(--color-line-on-dark)",
							fontSize: 14,
							lineHeight: 1.5,
						}}
					>
						{recap.takeaway}
					</p>
				) : null}
				{onSample ? (
					<p className="m-0 text-dark-faint" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 14 }}>
						The design&apos;s sample week. It becomes yours once your library holds files.
					</p>
				) : live ? (
					<div className="flex items-center" style={{ gap: 8, marginTop: 14 }}>
						<div className="flex flex-1 flex-col" style={{ gap: 5 }}>
							<div className="font-mono uppercase text-dark-faint" style={{ fontSize: 10.5 }}>
								Next · {recap.nextRecap}
							</div>
							<div
								role="progressbar"
								aria-label="How much of today has passed"
								aria-valuenow={parseInt(recap.recapProgress, 10)}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuetext={`${recap.recapProgress} of today; the week moves on ${recap.nextRecap}`}
								className="overflow-hidden bg-dark-track"
								style={{ height: 3, borderRadius: 2 }}
							>
								<div className="h-full bg-white" style={{ width: recap.recapProgress }} />
							</div>
						</div>
						<button
							type="button"
							aria-label="Rebuild the summary"
							disabled={rebuilding}
							onClick={() => void rebuild()}
							className="grid flex-none place-items-center bg-white/8 text-white active:bg-white/16 disabled:opacity-50"
							style={{ width: 40, height: 40 }}
						>
							<IconRefresh size={16} />
						</button>
					</div>
				) : (
					<div className="font-mono uppercase text-dark-faint" style={{ fontSize: 10.5, marginTop: 14 }}>
						{recap.nextRecap}
					</div>
				)}
			</section>

			{recap.sources.length > 0 ? (
				<>
					<SectionLabel style={{ padding: "18px 16px 4px" }}>Sources</SectionLabel>
					<div className="flex items-center overflow-x-auto" style={{ gap: 8, padding: "4px 16px" }}>
						{recap.sources.map((item) => {
							const className = "block flex-none truncate border border-line text-ink hover:text-ink active:bg-hover"
							const style = {
								maxWidth: 210,
								height: 36,
								lineHeight: "34px",
								padding: "0 12px",
								borderRadius: 6,
								fontSize: 13,
								textDecoration: "none",
							}
							// The sample's ids open nothing, so a sample source is plain text.
							return onSample ? (
								<span key={item.id} className={className} style={style}>
									{item.name}
								</span>
							) : (
								<Link key={item.id} to={paths.artifact(item.id)} className={className} style={style}>
									{item.name}
								</Link>
							)
						})}
						{recap.moreSources > 0 ? (
							<span className="font-mono flex-none text-muted-2" style={{ fontSize: 12 }}>
								+{recap.moreSources} more
							</span>
						) : null}
					</div>
				</>
			) : null}

			<label
				className="flex items-center border border-line-strong"
				style={{ margin: "18px 12px 4px", gap: 10, height: 44, padding: "0 12px", borderRadius: 6 }}
			>
				<IconSearch size={16} className="flex-none text-muted-2" />
				{/* 16px so iOS does not zoom into the field (README Chat composer). */}
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search every recap"
					aria-label="Search every recap"
					className="min-w-0 flex-1 bg-transparent outline-none"
					style={{ border: 0, fontSize: 16 }}
				/>
			</label>

			{nothing ? (
				<p className="m-0 text-center text-muted" style={{ padding: "32px 16px", fontSize: 14 }}>
					{searching ? "Nothing in any recap matches that." : recap.recapEmptyMsg}
				</p>
			) : (
				recap.groups.map((group) => (
					<RecapGroupBlock
						key={group.key}
						group={group}
						searching={searching}
						linkable={!onSample}
						projectLink={!onSample && projectIds.has(group.key) ? paths.project(group.key) : null}
						expanded={expanded[group.key] === true}
						onExpand={() => setExpanded((current) => ({ ...current, [group.key]: true }))}
						fileOf={(id) => byId.get(id)}
						meName={me.data?.name}
					/>
				))
			)}
		</>
	)
}

/** "You", or the owner's name as the library gives it. */
const whoOf = (file: RecapFile | undefined, meName: string | undefined) =>
	file === undefined ? "" : meName !== undefined && file.owner === meName ? "You" : file.owner

/** "uploaded" for a first Revision, "published v3 of" after (C:L1128). */
const verbOf = (rev: string) => (rev === "v1" ? "uploaded" : `published ${rev} of`)

/**
 * One Project's updates (W:L437–450): a 36px heading with the folder, name and count, opening the Project
 * where there is one to open, then a line per file ("Ada published v3 of Pricing"). A group past five lines
 * shows the rest on "Show N more" rather than in desktop's dialog.
 */
const RecapGroupBlock = ({
	group,
	searching,
	linkable,
	projectLink,
	expanded,
	onExpand,
	fileOf,
	meName,
}: {
	group: RecapGroup
	searching: boolean
	linkable: boolean
	projectLink: string | null
	expanded: boolean
	onExpand: () => void
	fileOf: (id: string) => RecapFile | undefined
	meName: string | undefined
}) => {
	const total = group.allItems.length
	const count = searching
		? `${total} ${total === 1 ? "match" : "matches"}`
		: `${total} ${total === 1 ? "update" : "updates"}`
	const rows = expanded ? group.allItems : group.visibleItems
	const heading = (
		<>
			<FolderGlyph size={18} />
			<span className="min-w-0 flex-1 truncate" style={{ fontSize: 15, fontWeight: 600 }}>
				{group.label}
			</span>
			<span className="flex-none text-muted-2" style={{ fontSize: 12 }}>
				{count}
			</span>
		</>
	)
	const headingStyle = { gap: 10, height: 36, textDecoration: "none" }

	return (
		<section aria-label={group.label} style={{ padding: "14px 16px 4px" }}>
			{projectLink ? (
				<Link to={projectLink} className="flex w-full items-center text-ink hover:text-ink" style={headingStyle}>
					{heading}
				</Link>
			) : (
				<div className="flex w-full items-center" style={headingStyle}>
					{heading}
				</div>
			)}
			<div className="flex flex-col" style={{ paddingLeft: 28 }}>
				{rows.map((row) => {
					const file = fileOf(row.id)
					const line = (
						<>
							<span className="text-ink" style={{ fontWeight: 500 }}>
								{whoOf(file, meName)}
							</span>{" "}
							{verbOf(row.rev)} {row.name}
						</>
					)
					const className = "block text-left text-secondary-2"
					const style = { padding: "6px 0", fontSize: 14, lineHeight: 1.45, textWrap: "pretty" as const }
					return linkable ? (
						<Link
							key={row.id}
							to={paths.artifact(row.id)}
							className={`${className} hover:text-secondary-2`}
							style={{ ...style, textDecoration: "none" }}
						>
							{line}
						</Link>
					) : (
						<div key={row.id} className={className} style={style}>
							{line}
						</div>
					)
				})}
				{group.hasMore && !expanded ? (
					<button
						type="button"
						onClick={onExpand}
						className="text-left text-ink active:bg-hover"
						style={{ padding: "6px 0", fontSize: 13, fontWeight: 600 }}
					>
						Show {group.moreCount} more
					</button>
				) : null}
			</div>
		</section>
	)
}
