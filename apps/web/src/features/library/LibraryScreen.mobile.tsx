import { type LibraryScope, type VisibleArtifact, type VisibleProject } from "@exagram/api-client"
import { useState } from "react"
import { Link, useNavigate } from "react-router"

import { FilterChips, GroupLabel, MobileScreen, NewFab, SectionLabel } from "@/components/mobile/primitives"
import { MobileFileRow, MobileProjectRow } from "@/components/mobile/rows"
import { useSheet } from "@/components/mobile/sheet/context"
import { IconPin } from "@/components/ui/icons"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { TypeTile } from "@/components/ui/TypeTile"
import { edition } from "@/edition/edition"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { useMe } from "@/features/auth/hooks/useMe"
import { groupArtifactsByRecency } from "@/features/library/grouping"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useMissingPreviewRedirect } from "@/features/library/hooks/useMissingPreviewRedirect"
import { usePinned } from "@/features/library/hooks/usePinned"
import { useProjects } from "@/features/library/hooks/useProjects"
import { activityWhen } from "@/features/library/lastActivity"
import { summarizeProjects } from "@/features/library/projectSummary"
import { sortArtifacts } from "@/features/library/sort"
import { paths } from "@/routes/paths"

const SCOPES: { value: LibraryScope; label: string; to: string }[] = [
	{ value: "all", label: "All", to: paths.library },
	{ value: "sharedWithMe", label: "Shared with me", to: paths.sharedWithMe },
	{ value: "mine", label: "My uploads", to: paths.mine },
]

/** The FOLDERS section shows this many before "Show all N". */
const PROJECTS_SHOWN = 5

const nameOf = (projectNames: Map<string, string>, artifact: VisibleArtifact) =>
	artifact.projectId === null ? null : (projectNames.get(artifact.projectId) ?? null)

/**
 * The Projects a scope lists: every one on All, someone else's on Shared with me, the reader's own
 * on My uploads. A nested Project sits under its parent unless the parent is out of sight.
 */
const projectsFor = (scope: LibraryScope, projects: VisibleProject[], meId: string | undefined) => {
	const visible = new Set(projects.map((project) => project.id))
	return projects
		.filter((project) => project.parentProjectId === null || !visible.has(project.parentProjectId))
		.filter((project) =>
			scope === "sharedWithMe" ? project.ownerId !== meId : scope === "mine" ? project.ownerId === meId : true,
		)
}

/** A 220px card in the PINNED carousel: type tile and a filled pin, a 2-line name, "Project · age". */
const PinnedCard = ({ artifact, projectName }: { artifact: VisibleArtifact; projectName: string | null }) => (
	<Link
		to={paths.artifact(artifact.id)}
		className="flex flex-none flex-col border border-line text-left text-ink hover:text-ink active:bg-row-hover"
		style={{ width: 220, borderRadius: 10, padding: 12, gap: 10, textDecoration: "none" }}
	>
		<div className="flex items-center justify-between">
			<TypeTile kind={artifact.kind} size={30} />
			<IconPin size={15} fill="currentColor" className="text-ink" />
		</div>
		<div
			style={{
				fontSize: 14,
				fontWeight: 500,
				lineHeight: 1.35,
				minHeight: 38,
				display: "-webkit-box",
				WebkitLineClamp: 2,
				WebkitBoxOrient: "vertical",
				overflow: "hidden",
			}}
		>
			{artifact.title}
		</div>
		<div className="text-muted-2" style={{ fontSize: 12 }}>
			{`${projectName ?? "No folder"} · ${activityWhen(artifact.updatedAt)}`}
		</div>
	</Link>
)

// Fixed widths, so the placeholder reads as a list and never reshuffles on render.
const NAME_WIDTHS = ["58%", "72%", "46%", "64%", "52%"]

/** Rows shaped like `MobileFileRow` (56px, 30px tile, name over meta) while the list loads. */
const LoadingRows = () => (
	<SkeletonStatus label="Loading files…" style={{ padding: "12px 6px 0" }}>
		{NAME_WIDTHS.map((width) => (
			<div key={width} className="flex items-center" style={{ gap: 12, height: 56, padding: "0 10px" }}>
				<Skeleton width={30} height={30} radius={6} />
				<div className="flex min-w-0 flex-1 flex-col" style={{ gap: 6 }}>
					<Skeleton width={width} height={12} />
					<Skeleton width="36%" height={10} />
				</div>
			</div>
		))}
	</SkeletonStatus>
)

/**
 * Screen 1 on a phone: the scope chips, PINNED, FOLDERS and the files by recency, with
 * the floating New. Each scope keeps its own address, as on desktop, so the chips navigate.
 */
export default function LibraryScreenMobile({ scope }: { scope: LibraryScope }) {
	const navigate = useNavigate()
	const sheet = useSheet()
	const me = useMe()
	const projects = useProjects()
	const everything = useArtifacts({ scope: "all" })
	useMissingPreviewRedirect(everything.data, everything.isSuccess)
	const shared = useArtifacts({ scope: "sharedWithMe" })
	const mine = useArtifacts({ scope: "mine" })
	const pending = usePendingRevisions()
	const pinned = usePinned()
	const [allProjects, setAllProjects] = useState(false)

	const byScope = { all: everything, sharedWithMe: shared, mine }
	const listed = byScope[scope]
	const artifacts = everything.data ?? []
	const projectList = projects.data ?? []
	const projectNames = new Map(projectList.map((project) => [project.id, project.name]))
	const { countFor, isShared } = summarizeProjects(projectList, artifacts, me.data?.id)
	const waiting = new Set((pending.data ?? []).map((revision) => revision.artifactId))

	// The design keeps PINNED to All: the other scopes are filters, a carousel above them would not be.
	const pinnedArtifacts =
		edition.pins && scope === "all" ? artifacts.filter((artifact) => pinned.isPinned(artifact.id)) : []
	const scopeProjects = projectsFor(scope, projectList, me.data?.id)
	const shownProjects = allProjects ? scopeProjects : scopeProjects.slice(0, PROJECTS_SHOWN)
	const files = listed.data ?? []
	const groups = groupArtifactsByRecency(sortArtifacts(files, "updated"))

	return (
		<MobileScreen
			label="Artifacts"
			bodyStyle={{ paddingBottom: 96 }}
			fab={<NewFab onClick={() => sheet.open("new", { projectId: null })} />}
		>
			<FilterChips
				label="Library scope"
				value={scope}
				onChange={(next) => {
					const target = SCOPES.find((option) => option.value === next)
					if (target) void navigate(target.to)
				}}
				options={SCOPES.map((option) => ({
					value: option.value,
					label: option.label,
					count: byScope[option.value].data?.length,
				}))}
			/>

			{pinnedArtifacts.length > 0 ? (
				<section aria-label="Pinned">
					<SectionLabel style={{ padding: "10px 16px 6px" }}>Pinned</SectionLabel>
					<div className="flex overflow-x-auto" style={{ gap: 10, padding: "2px 16px 8px" }}>
						{pinnedArtifacts.map((artifact) => (
							<PinnedCard key={artifact.id} artifact={artifact} projectName={nameOf(projectNames, artifact)} />
						))}
					</div>
				</section>
			) : null}

			{scopeProjects.length > 0 ? (
				<section aria-label="Folders">
					<SectionLabel>Folders</SectionLabel>
					<div style={{ padding: "0 6px" }}>
						{shownProjects.map((project) => (
							<MobileProjectRow
								key={project.id}
								projectId={project.id}
								name={project.name}
								count={countFor(project.id)}
								shared={isShared(project)}
							/>
						))}
						{scopeProjects.length > PROJECTS_SHOWN ? (
							<button
								type="button"
								onClick={() => setAllProjects((current) => !current)}
								className="text-muted active:bg-row-hover"
								style={{ height: 44, padding: "0 10px", fontSize: 14, fontWeight: 500 }}
							>
								{allProjects ? "Show fewer" : `Show all ${scopeProjects.length}`}
							</button>
						) : null}
					</div>
				</section>
			) : null}

			{listed.isError ? (
				<p role="alert" className="text-danger" style={{ padding: "16px", fontSize: 14 }}>
					{listed.error.message}
				</p>
			) : null}

			{listed.isPending ? <LoadingRows /> : null}

			{listed.isSuccess && files.length === 0 ? (
				<div className="text-muted" style={{ padding: "48px 24px", textAlign: "center", fontSize: 14 }}>
					No files here yet. Tap New to upload one — nobody else can see it until you invite them.
				</div>
			) : null}

			<div style={{ padding: "0 6px" }}>
				{groups.map((group) => (
					<section key={group.label} aria-label={group.label}>
						<GroupLabel>{group.label}</GroupLabel>
						{group.artifacts.map((artifact) => (
							<MobileFileRow
								key={artifact.id}
								artifact={artifact}
								projectName={nameOf(projectNames, artifact)}
								pending={waiting.has(artifact.id)}
								onMore={() => sheet.open("file", { artifactId: artifact.id })}
							/>
						))}
					</section>
				))}
			</div>
		</MobileScreen>
	)
}
