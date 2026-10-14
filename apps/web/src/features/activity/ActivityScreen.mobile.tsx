import { type PendingRevision, type Project, type VisibleArtifact } from "@exagram/api-client"
import clsx from "clsx"
import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"

import { GroupLabel, MobileScreen, PushHeader } from "@/components/mobile/primitives"
import { SkeletonRows } from "@/components/ui/Skeleton"
import { TypeTile } from "@/components/ui/TypeTile"
import { AccessRequests } from "@/features/access-requests/AccessRequests"
import {
	buildFeed,
	type FeedEvent,
	feedFor,
	type FeedScope,
	groupByDay,
	pendingAuthor,
} from "@/features/activity/activityFeed"
import { isUnread, markSeen, useLastSeen, useMarkSeenOnLeave } from "@/features/activity/lastSeen"
import { locationLabel, locationOf } from "@/features/activity/location"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { DecisionButtons, PendingNotes } from "@/features/artifact/PendingDecision.mobile"
import { usePendingDecision } from "@/features/artifact/usePendingDecision.mobile"
import { useMe } from "@/features/auth/hooks/useMe"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useMissingPreviewRedirect } from "@/features/library/hooks/useMissingPreviewRedirect"
import { useProjects } from "@/features/library/hooks/useProjects"
import { activityWhen } from "@/features/library/lastActivity"
import { useStateScope } from "@/features/workspace/stateScope"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"
import { paths } from "@/routes/paths"
import { initialsOf } from "@/utils/initials"
import { useNow } from "@/utils/useNow"

const SCOPE_PARAM = "scope"

/**
 * The 2-up Mine / Team toggle with a Geist Mono count. The shared `Segmented` has no count yet, so
 * this one draws it; Wave 2 folds the count into the primitive.
 */
const ScopeToggle = ({
	value,
	counts,
	onChange,
}: {
	value: FeedScope
	counts: Record<FeedScope, number>
	onChange: (value: FeedScope) => void
}) => (
	<div style={{ padding: "12px 16px 8px" }}>
		<div
			role="radiogroup"
			aria-label="Whose activity"
			className="grid border border-line-segment"
			style={{ gridTemplateColumns: "1fr 1fr", padding: 2, borderRadius: 8 }}
		>
			{(["mine", "team"] as const).map((scope) => {
				const on = scope === value
				return (
					<button
						key={scope}
						type="button"
						role="radio"
						aria-checked={on}
						onClick={() => onChange(scope)}
						className={clsx("flex items-center justify-center", on ? "bg-ink text-white" : "text-secondary")}
						style={{ height: 34, gap: 6, fontSize: 14, fontWeight: on ? 600 : 500, transition: "background 200ms" }}
					>
						{scope === "mine" ? "Mine" : "Team"}
						<span className="font-mono" style={{ fontSize: 11.5, opacity: 0.6 }}>
							{counts[scope]}
						</span>
					</button>
				)
			})}
		</div>
	</div>
)

/** "Needs your action": the amber card of Revisions this person approves, each with its pair. */
const NeedsAction = ({ revisions, now }: { revisions: PendingRevision[]; now: Date }) => {
	const me = useMe()
	const decision = usePendingDecision()
	if (revisions.length === 0) return null
	return (
		<section
			aria-label="Needs your action"
			className="bg-pending-bg"
			style={{ margin: "6px 12px", borderRadius: 10, padding: "14px 14px 4px" }}
		>
			<div className="flex items-center text-pending-fg" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>
				<span aria-hidden className="bg-pending" style={{ width: 7, height: 7, borderRadius: "50%" }} />
				<h2 className="m-0 flex-1" style={{ fontSize: 13, fontWeight: 600 }}>
					Needs your action
				</h2>
				<span
					className="font-mono"
					style={{ fontSize: 11, background: "rgba(217,134,11,.35)", padding: "2px 7px", borderRadius: 6 }}
				>
					{revisions.length}
				</span>
			</div>
			<ul className="m-0 list-none p-0">
				{revisions.map((revision) => {
					const author = pendingAuthor(revision, me.data?.id ?? null)
					return (
						<li key={revision.revisionId} className="flex flex-col" style={{ padding: "14px 0 12px", gap: 12 }}>
							<Link
								to={paths.artifact(revision.artifactId)}
								className="flex items-start text-ink hover:text-ink"
								style={{ gap: 12, textDecoration: "none" }}
							>
								<TypeTile kind={revision.kind} size={30} />
								<div className="min-w-0 flex-1">
									<div className="line-clamp-2" style={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.35 }}>
										{revision.title}
									</div>
									<div className="text-pending-fg" style={{ fontSize: 12.5, marginTop: 3 }}>
										{`v${revision.seq} ${author === "You" ? "· your upload" : `from ${author}`} · ${activityWhen(revision.createdAt, now)}`}
									</div>
								</div>
							</Link>
							<div className="flex flex-col" style={{ gap: 8, paddingLeft: 42 }}>
								<PendingNotes revision={revision} />
								<DecisionButtons revision={revision} decision={decision} height={40} preview />
							</div>
						</li>
					)
				})}
			</ul>
			{decision.dialog}
		</section>
	)
}

/** "published v3 of", "uploaded" for a first version, "submitted v4 of" for one awaiting approval. */
const verbOf = (event: FeedEvent, artifact: VisibleArtifact | undefined, pending: PendingRevision | undefined) => {
	if (event.pending) return pending ? `submitted v${pending.seq} of` : "submitted"
	const seq = artifact?.revisionSeq ?? null
	return seq === 1 ? "uploaded" : seq === null ? "published" : `published v${seq} of`
}

/**
 * A feed row: initials, "**Who** verb **File**", then the file's place and the time. An unread
 * row is tinted `row-hover` (#F7F7FA) with a dot at its left edge.
 */
const FeedRow = ({
	event,
	verb,
	place,
	unread,
}: {
	event: FeedEvent
	verb: string
	place: { label: string; loose: boolean } | null
	unread: boolean
}) => (
	<Link
		to={paths.artifact(event.artifactId)}
		className={clsx(
			"relative flex w-full items-start text-ink hover:text-ink active:bg-row-hover",
			unread ? "bg-row-hover" : null,
		)}
		style={{ gap: 12, padding: "10px 16px", textDecoration: "none" }}
	>
		{unread ? (
			<span
				aria-label="Unread"
				className="absolute bg-ink"
				style={{ left: 6, top: 24, width: 6, height: 6, borderRadius: "50%" }}
			/>
		) : null}
		<span
			aria-hidden
			className="grid flex-none place-items-center bg-subtle text-ink"
			style={{ width: 32, height: 32, borderRadius: "50%", fontSize: 11.5, fontWeight: 600 }}
		>
			{event.actor}
		</span>
		<div className="min-w-0 flex-1">
			<div className="text-secondary-2" style={{ fontSize: 14.5, lineHeight: 1.4, textWrap: "pretty" }}>
				<span className="text-ink" style={{ fontWeight: 600 }}>
					{event.who}
				</span>{" "}
				{verb}{" "}
				<span className="text-ink" style={{ fontWeight: 500 }}>
					{event.target}
				</span>
			</div>
			<div className="flex items-center text-muted-2" style={{ gap: 8, marginTop: 5, fontSize: 12 }}>
				{place ? (
					<span
						className={clsx("truncate", place.loose ? "bg-unsorted-bg text-pending-fg" : "bg-row-selected text-muted")}
						style={{ padding: "2px 7px", borderRadius: 5, maxWidth: 200 }}
					>
						{place.label}
					</span>
				) : null}
				<span className="font-mono" style={{ fontSize: 11.5 }}>
					{event.time}
				</span>
			</div>
		</div>
	</Link>
)

/** A file's place for its chip; a file in no Project, or loose in one with folders, is tinted amber. */
const placeOf = (artifact: VisibleArtifact | undefined, projects: Project[]) => {
	if (artifact === undefined) return null
	const location = locationOf(artifact.projectId, projects)
	return {
		label: locationLabel(location),
		loose: location.needsFolder || (location.project === null && !location.elsewhere),
	}
}

/**
 * Activity on a phone (`/activity`): the notification inbox the bell opens. What waits
 * for this person's approval, then the feed by day, Mine or Team (`?scope=team`, as desktop). Others'
 * publishes in the last day are unread until this person leaves the screen or marks all read.
 */
export default function ActivityScreenMobile() {
	const me = useMe()
	const [params, setParams] = useSearchParams()
	const everything = useArtifacts({ scope: "all" })
	useMissingPreviewRedirect(everything.data, everything.isSuccess)
	const projects = useProjects()
	const pending = usePendingRevisions()
	const now = useNow()

	// The rows keep the read line they arrived with, so they stay unread while this person looks at them;
	// leaving marks them read for the bell. Mark all read moves both at once.
	const stored = useLastSeen()
	const stateScope = useStateScope()
	const [seen, setSeen] = useState(stored)
	useMarkSeenOnLeave()
	const markAllRead = () => {
		const at = Date.now()
		setSeen(at)
		markSeen(stateScope, at)
	}

	const personal = useWorkspaceKind() === "personal"
	const scope: FeedScope = personal || params.get(SCOPE_PARAM) === "team" ? "team" : "mine"
	const setScope = (next: FeedScope) =>
		setParams(
			(previous) => {
				const nextParams = new URLSearchParams(previous)
				if (next === "team") nextParams.set(SCOPE_PARAM, "team")
				else nextParams.delete(SCOPE_PARAM)
				return nextParams
			},
			{ replace: true },
		)

	const artifacts = useMemo(() => everything.data ?? [], [everything.data])
	const queue = useMemo(() => pending.data ?? [], [pending.data])
	const projectList = projects.data ?? []
	const meId = me.data?.id ?? null
	const meInitials = initialsOf(me.data?.name, me.data?.email)

	const all = useMemo(
		() => buildFeed({ artifacts, pending: queue, meId, meInitials }),
		[artifacts, queue, meId, meInitials],
	)
	const mine = feedFor(all, "mine")
	const team = feedFor(all, "team")
	const shown = scope === "mine" ? mine : team
	const groups = groupByDay(shown.events, now)

	const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
	// The feed keys a pending event by its Revision (`pending:<id>`), which is how its version is found again.
	const pendingByKey = new Map(queue.map((revision) => [`pending:${revision.revisionId}`, revision]))
	// Only the Approver the server names acts, and only on a file this person can list.
	const waiting = queue.filter((revision) => revision.isApprover && byId.has(revision.artifactId))
	const loading = everything.isPending || pending.isPending

	return (
		<MobileScreen
			push
			label="Activity"
			header={
				<PushHeader
					to={paths.library}
					title="Activity"
					actions={
						<button
							type="button"
							onClick={markAllRead}
							className="flex-none text-secondary active:bg-hover"
							style={{ height: 36, padding: "0 10px", fontSize: 13.5, fontWeight: 500 }}
						>
							Mark all read
						</button>
					}
				/>
			}
			bodyStyle={{ paddingBottom: 24 }}
		>
			{personal ? null : (
				<ScopeToggle value={scope} counts={{ mine: mine.total, team: team.total }} onChange={setScope} />
			)}
			{loading ? (
				<SkeletonRows label="Loading activity…" count={8} showMeta={false} />
			) : (
				<>
					<AccessRequests mobile />
					<NeedsAction revisions={waiting} now={now} />
					{shown.total === 0 ? (
						<p className="m-0 text-center text-muted" style={{ padding: "64px 24px", fontSize: 15 }}>
							{scope === "mine" && team.total > 0
								? `Nothing of yours yet — Team shows ${team.total} ${team.total === 1 ? "event" : "events"}.`
								: "Nothing has happened yet."}
						</p>
					) : (
						groups.map((group) => (
							<section key={group.key} aria-label={group.name}>
								<div style={{ paddingLeft: 6 }}>
									<GroupLabel>{group.name}</GroupLabel>
								</div>
								{group.events.map((event) => (
									<FeedRow
										key={event.key}
										event={event}
										verb={verbOf(event, byId.get(event.artifactId), pendingByKey.get(event.key))}
										place={placeOf(byId.get(event.artifactId), projectList)}
										unread={isUnread(event, seen, now)}
									/>
								))}
							</section>
						))
					)}
				</>
			)}
		</MobileScreen>
	)
}
