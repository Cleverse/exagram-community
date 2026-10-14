import { useMemo, useState } from "react"
import { useSearchParams } from "react-router"

import { SegmentedControl } from "@/components/ui/Chip"
import { SkeletonRows } from "@/components/ui/Skeleton"
import { AccessRequests } from "@/features/access-requests/AccessRequests"
import { useAccessRequests } from "@/features/access-requests/hooks/useAccessRequests"
import { buildFeed, feedFor, type FeedScope, groupByDay } from "@/features/activity/activityFeed"
import { EventTable } from "@/features/activity/EventTable"
import { NeedsAction } from "@/features/activity/NeedsAction"
import { needsActionGroups } from "@/features/activity/needsActionGroups"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { useMe } from "@/features/auth/hooks/useMe"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useArtifactSelection } from "@/features/library/hooks/useArtifactSelection"
import { useListWidth } from "@/features/library/hooks/useListWidth"
import { useMissingPreviewRedirect } from "@/features/library/hooks/useMissingPreviewRedirect"
import { useProjects } from "@/features/library/hooks/useProjects"
import { useTallViewport } from "@/features/library/hooks/useViewport"
import { LibraryShell } from "@/features/library/LibraryShell"
import { ListHeader, PageTitle } from "@/features/library/ListHeader"
import { isScrolled, pageHeaderSize } from "@/features/library/pageHeader"
import { previewNavFor } from "@/features/library/previewNav"
import { PreviewPane } from "@/features/library/PreviewPane"
import { useRegisterArtifactSelect } from "@/features/library/useLibraryActions"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"
import { paths } from "@/routes/paths"
import { initialsOf } from "@/utils/initials"
import { useNow } from "@/utils/useNow"

const SCOPE_PARAM = "scope"

const Empty = ({ children }: { children: string }) => (
	<div className="text-center text-muted" style={{ padding: "64px 24px", fontSize: 15 }}>
		{children}
	</div>
)

/**
 * Activity (`/activity`): the member's feed. What waits for their approval, then
 * the events around the files they can see, by day. Mine / Team filters the feed, which is built here from
 * the library and the pending queue; the choice lives in the URL (`?scope=team`). A row opens the same
 * content window as the library, as `/activity?preview=:id`.
 */
export const ActivityScreen = () => {
	const me = useMe()
	const [params, setParams] = useSearchParams()
	const everything = useArtifacts({ scope: "all" })
	const projects = useProjects()
	const pending = usePendingRevisions()
	const requested = useAccessRequests().data?.length ?? 0
	const listWidth = useListWidth()
	const [scrolled, setScrolled] = useState(false)
	const headerSize = pageHeaderSize({ tall: useTallViewport(), scrolled })

	const personal = useWorkspaceKind() === "personal"
	const asksForTeam = params.get(SCOPE_PARAM) === "team"
	const scope: FeedScope = personal || asksForTeam ? "team" : "mine"
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
	const projectList = projects.data ?? []
	const meId = me.data?.id ?? null
	const meInitials = initialsOf(me.data?.name, me.data?.email)

	const selection = useArtifactSelection(artifacts)
	useRegisterArtifactSelect(selection.select)
	const previewOpen = selection.selected !== null
	useMissingPreviewRedirect(artifacts, everything.isSuccess)

	const now = useNow()
	const all = useMemo(
		() => buildFeed({ artifacts, pending: pending.data ?? [], meId, meInitials }),
		[artifacts, pending.data, meId, meInitials],
	)
	// Each scope is filtered first and capped after, so Mine is never crowded out of a busy Team feed; the
	// counts are the uncapped totals.
	const mine = feedFor(all, "mine")
	const team = feedFor(all, "team")
	const shown = scope === "mine" ? mine : team
	const groups = groupByDay(shown.events, now)
	const approvals = needsActionGroups({ pending: pending.data ?? [], artifacts, projects: projectList })
	const projectNames = new Map(projectList.map((project) => [project.id, project.name]))

	// A file with no Project steps through this feed's files in the order their rows are drawn.
	const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
	const feedOrder = [...new Set(groups.flatMap((group) => group.events.map((event) => event.artifactId)))].flatMap(
		(artifactId) => byId.get(artifactId) ?? [],
	)
	// The feed is built from both queries, so neither an empty state nor a partial feed shows until both land.
	const loading = everything.isPending || pending.isPending

	const nav = selection.selected
		? previewNavFor({
				artifact: selection.selected,
				everything: artifacts,
				projectNames,
				list: feedOrder,
				listFolder: {
					kind: "list",
					name: "Activity",
					href: asksForTeam ? `${paths.activity}?${SCOPE_PARAM}=team` : paths.activity,
				},
			})
		: null

	return (
		<LibraryShell
			listWidth={listWidth.width}
			preview={
				selection.selected && nav ? (
					<PreviewPane
						artifact={selection.selected}
						siblings={nav.siblings}
						folder={nav.folder}
						onStep={selection.step}
						projectName={
							selection.selected.projectId === null ? null : (projectNames.get(selection.selected.projectId) ?? null)
						}
						fullView={false}
						// Open leaves the list for the file's own page; Back there returns here with it previewed.
						onFullViewChange={(next) => {
							if (next && selection.selected) selection.open(selection.selected.id)
						}}
						onClose={selection.clear}
						listWidth={listWidth}
					/>
				) : undefined
			}
		>
			<>
				<ListHeader
					size={headerSize}
					title={
						<div className="flex min-w-0 items-baseline overflow-hidden" style={{ gap: 10 }}>
							<PageTitle size={headerSize} className="flex-none">
								Activity
							</PageTitle>
							<span className="min-w-0 truncate text-muted" style={{ fontSize: 14 }}>
								{`${shown.total} ${shown.total === 1 ? "event" : "events"}${personal ? "" : ` · ${scope === "mine" ? "yours" : "team"}`}`}
							</span>
						</div>
					}
					actions={
						personal ? undefined : (
							<SegmentedControl
								ariaLabel="Whose activity"
								options={[
									{ value: "mine", label: "Mine", count: mine.total },
									{ value: "team", label: "Team", count: team.total },
								]}
								value={scope}
								onChange={setScope}
							/>
						)
					}
				/>

				<div
					onScroll={(event) => setScrolled(isScrolled(event.currentTarget.scrollTop))}
					className="flex-1 overflow-auto"
					style={{ padding: "0 28px 48px", scrollbarGutter: "stable" }}
				>
					{loading ? null : (
						<>
							<AccessRequests />
							<NeedsAction groups={approvals} wide={!previewOpen} />
						</>
					)}

					{/* 36px under the approvals and requests, 12px when there are none. */}
					<div style={{ marginTop: approvals.length > 0 || requested > 0 ? 36 : 12 }}>
						{loading ? (
							<SkeletonRows label="Loading activity…" count={8} showMeta={!previewOpen} />
						) : shown.total === 0 ? (
							<Empty>
								{scope === "mine" && team.total > 0
									? `Nothing of yours yet — Team shows ${team.total} ${team.total === 1 ? "event" : "events"}.`
									: "Nothing has happened yet."}
							</Empty>
						) : (
							<EventTable
								groups={groups}
								artifacts={artifacts}
								projects={projectList}
								meId={meId}
								selectedId={selection.selectedId}
								onSelect={selection.select}
								wide={!previewOpen}
							/>
						)}
					</div>
				</div>
			</>
		</LibraryShell>
	)
}
