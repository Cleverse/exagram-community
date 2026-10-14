import { type VisibleProject } from "@exagram/api-client"
import clsx from "clsx"
import { type ComponentProps, type MouseEvent, type ReactNode, useState } from "react"
import { Link, useLocation } from "react-router"

import { SidebarCount, SidebarLink } from "@/components/sidebar/SidebarLink"
import { IconButton } from "@/components/ui/IconButton"
import {
	IconChevronRight,
	IconFolder,
	IconProjectFolder,
	IconProjectFolderOpen,
	IconGrid,
	IconPerson,
	IconPin,
	IconPlus,
} from "@/components/ui/icons"
import { SectionLabel } from "@/components/ui/Mono"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { edition } from "@/edition/edition"
import { useMe } from "@/features/auth/hooks/useMe"
import { useDragState } from "@/features/library/dragState"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useCanPreview } from "@/features/library/hooks/useCanPreview"
import {
	DROP_TARGET_CLASS,
	DROP_ZONE_CLASS,
	useFolderDrop,
	useProjectDrag,
} from "@/features/library/hooks/useFolderDrop"
import { usePinned } from "@/features/library/hooks/usePinned"
import { useProjects } from "@/features/library/hooks/useProjects"
import { isSharedProject, rootProjects, summarizeProjects } from "@/features/library/projectSummary"
import { useLibraryActions } from "@/features/library/useLibraryActions"
import { paths, projectIdOf, withPreview } from "@/routes/paths"

const LIBRARY_ROOTS: string[] = [paths.library, paths.sharedWithMe, paths.mine]

/**
 * A collapsible section header: the kicker links to the Folders screen, and the caret beside
 * it folds the rows under it, turning from → to ↓ while the section is open.
 */
const SectionToggle = ({
	label,
	to,
	current,
	open,
	onToggle,
	trailing,
}: {
	label: string
	to: string
	current: boolean
	open: boolean
	onToggle: () => void
	trailing?: ReactNode
}) => (
	<div className="flex items-center" style={{ gap: 8, margin: "18px 0 6px", padding: "0 8px 0 10px" }}>
		<Link
			to={to}
			aria-current={current ? "page" : undefined}
			className={clsx("mono-kicker min-w-0 flex-1 truncate text-left hover:text-ink", current && "text-ink")}
		>
			{label}
		</Link>
		<button
			type="button"
			aria-expanded={open}
			aria-label={`${open ? "Collapse" : "Expand"} ${label.toLowerCase()}`}
			onClick={onToggle}
			className="mono-kicker grid flex-none place-items-center hover:text-ink"
			style={{ width: 20, height: 20 }}
		>
			<IconChevronRight
				size={12}
				strokeWidth={2.4}
				style={{
					transform: `rotate(${open ? 90 : 0}deg)`,
					transition: "transform var(--duration-row) var(--ease-arrive)",
				}}
			/>
		</button>
		{trailing}
	</div>
)

/**
 * A sidebar Project that is also a folder to drop onto: a file row dragged from the list moves into
 * it, a desktop file uploads into it, and another Project dropped on it becomes its folder. The Owner can drag
 * the row itself onto another Project to nest it there.
 */
const FolderSidebarLink = ({
	project,
	className,
	...rest
}: { project: VisibleProject } & ComponentProps<typeof SidebarLink>) => {
	const { over, dropHandlers } = useFolderDrop<HTMLAnchorElement>({ projectId: project.id })
	const { beingDragged, dragHandlers } = useProjectDrag(project.id)
	return (
		<SidebarLink
			{...rest}
			{...dropHandlers}
			{...dragHandlers}
			className={clsx(className, over && DROP_TARGET_CLASS, beingDragged && "opacity-45")}
		/>
	)
}

/**
 * The FOLDERS section as a whole, header included: a folder dragged out of its Project and dropped here goes
 * back to the top level. The rows inside answer a Project drag themselves, so only the rest of the section does.
 */
const TopLevelDropSection = ({ children }: { children: ReactNode }) => {
	const { over, dropHandlers } = useFolderDrop<HTMLDivElement>({ projectId: null, projectsOnly: true })
	return (
		<div {...dropHandlers} className={clsx(over && DROP_TARGET_CLASS, "rounded-[8px]")}>
			{children}
		</div>
	)
}

/**
 * The sidebar's Artifacts body: All artifacts, PINNED, SHARED FOLDERS,
 * FOLDERS. It carries the only Project navigation in the app and doubles as the drop target that moves
 * an Artifact into a Project (the server makes the move itself). What is active comes from the
 * route, so the body reads the same on every screen the Artifacts section shows beside.
 */
export const LibrarySidebar = () => {
	const location = useLocation()
	const actions = useLibraryActions()
	const projects = useProjects()
	// Counts are the whole readable library, not the open scope, so a Project's count never changes with the tab.
	const everything = useArtifacts({ scope: "all" })
	const me = useMe()
	const pinned = usePinned()
	const [sharedOpen, setSharedOpen] = useState(true)
	// While a file or Project row is dragged, the project lists it can go to wear the dashed drop zone.
	const { dragged, draggedProject } = useDragState()
	const dropZone = dragged || draggedProject ? DROP_ZONE_CLASS : undefined
	const [mineOpen, setMineOpen] = useState(true)
	// A Project's folders show under it while it or one of them is open, until its caret says otherwise.
	const [folded, setFolded] = useState<Record<string, boolean>>({})

	const base = location.pathname
	const canPreview = useCanPreview()
	const activeProjectId = projectIdOf(location.pathname)
	const libraryActive = LIBRARY_ROOTS.includes(base)
	const activityActive = base === paths.activity
	const projectsActive = base === paths.projects
	// The design hides PINNED on "My uploads".
	const showPinned = edition.pins && base !== paths.mine

	const artifacts = everything.data ?? []
	const all = projects.data ?? []
	const roots = rootProjects(all)
	const sharedHere = (project: VisibleProject) => isSharedProject(project, me.data?.id)
	const shared = roots.filter(sharedHere)
	const mine = roots.filter((project) => !sharedHere(project))

	const { countFor } = summarizeProjects(all, artifacts, me.data?.id)

	const pinnedArtifacts = showPinned ? artifacts.filter((artifact) => pinned.isPinned(artifact.id)) : []

	// A pinned row's address is the preview inside the list on screen when the window has room for it, or the
	// Artifact's own page otherwise.
	const onList = libraryActive || activityActive || activeProjectId !== null
	const pinnedHref = (artifactId: string) =>
		onList && canPreview ? withPreview(base, location.search, artifactId) : paths.artifact(artifactId)
	// A plain click hands the list its own selection (it keeps Back and the pane state right); a modified click
	// opens the address like any link.
	const openPinned = (artifactId: string) => (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
		event.preventDefault()
		actions.selectArtifact(artifactId)
	}

	const childrenOf = (projectId: string) => all.filter((project) => project.parentProjectId === projectId)

	const childRow = (child: VisibleProject) => {
		const count = countFor(child.id)
		return (
			<FolderSidebarLink
				key={child.id}
				project={child}
				active={child.id === activeProjectId}
				to={paths.project(child.id)}
				icon={<IconFolder size={17} className="flex-none text-secondary" />}
				trailing={count > 0 ? <SidebarCount>{count}</SidebarCount> : null}
			>
				<span className="min-w-0 truncate">{child.name}</span>
			</FolderSidebarLink>
		)
	}

	const projectRow = (project: VisibleProject) => {
		const active = project.id === activeProjectId
		// Under SHARED FOLDERS every row is shared, so the one-person mark picks out the ones you share out.
		const sharedByYou = project.ownerId === me.data?.id && sharedHere(project)
		const children = childrenOf(project.id)
		const holdsOpen = active || children.some((child) => child.id === activeProjectId)
		const expanded = children.length > 0 && !(folded[project.id] ?? !holdsOpen)
		const groupId = `sidebar-folders-${project.id}`

		const link = (
			<FolderSidebarLink
				project={project}
				active={active}
				to={paths.project(project.id)}
				icon={
					expanded ? (
						<IconProjectFolderOpen className="flex-none group-hover/folder:invisible" />
					) : (
						<IconProjectFolder className={clsx("flex-none", children.length > 0 && "group-hover/folder:invisible")} />
					)
				}
				trailing={<SidebarCount>{countFor(project.id)}</SidebarCount>}
			>
				<span className="min-w-0 truncate">{project.name}</span>
				{sharedByYou ? (
					<>
						<IconPerson size={12} className="flex-none text-muted" />
						<span className="sr-only">Shared by you</span>
					</>
				) : null}
			</FolderSidebarLink>
		)
		if (children.length === 0) return <div key={project.id}>{link}</div>

		// The caret sits over the folder icon and shows on hover, so the row itself stays one link to the Project.
		return (
			<div key={project.id} className="flex flex-col" style={{ gap: 1 }}>
				<div className="group/folder relative">
					{link}
					<button
						type="button"
						aria-expanded={expanded}
						aria-controls={groupId}
						aria-label={`${expanded ? "Hide" : "Show"} folders in ${project.name}`}
						onClick={() => setFolded({ ...folded, [project.id]: expanded })}
						className="absolute flex items-center justify-center rounded-[4px] text-secondary opacity-0 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover/folder:opacity-100"
						style={{ left: 6, top: 7, width: 20, height: 20 }}
					>
						<IconChevronRight
							size={12}
							strokeWidth={2.4}
							style={{
								transform: `rotate(${expanded ? 90 : 0}deg)`,
								transition: "transform var(--duration-row) var(--ease-arrive)",
							}}
						/>
					</button>
				</div>
				{expanded ? (
					<div
						id={groupId}
						role="group"
						aria-label={`Folders in ${project.name}`}
						className="flex flex-col"
						style={{ gap: 1, paddingLeft: 22 }}
					>
						{children.map(childRow)}
					</div>
				) : null}
			</div>
		)
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "16px 12px 12px" }}>
			<SidebarLink
				active={libraryActive}
				to={paths.library}
				icon={<IconGrid size={16} className="flex-none text-secondary" />}
			>
				All artifacts
			</SidebarLink>

			{pinnedArtifacts.length > 0 ? (
				<>
					<SectionLabel variant="sidebar" style={{ margin: "18px 8px 6px 10px" }}>
						Pinned
					</SectionLabel>
					<div className="flex flex-col" style={{ gap: 1 }}>
						{pinnedArtifacts.map((artifact) => (
							<SidebarLink
								key={artifact.id}
								to={pinnedHref(artifact.id)}
								onClick={openPinned(artifact.id)}
								icon={<IconPin size={15} fill="currentColor" className="flex-none text-ink" />}
							>
								<span className="min-w-0 truncate">{artifact.title}</span>
							</SidebarLink>
						))}
					</div>
				</>
			) : null}

			{shared.length > 0 ? (
				<>
					<SectionToggle
						label="Shared folders"
						to={paths.projects}
						current={projectsActive}
						open={sharedOpen}
						onToggle={() => setSharedOpen(!sharedOpen)}
					/>
					{sharedOpen ? (
						<nav
							aria-label="Shared folders"
							// Only a Project you own takes a file, so the list rings only when it holds one.
							className={clsx("flex flex-col", shared.some((project) => project.ownerId === me.data?.id) && dropZone)}
							style={{ gap: 1 }}
						>
							{shared.map(projectRow)}
						</nav>
					) : null}
				</>
			) : null}

			<TopLevelDropSection>
				<SectionToggle
					label="Folders"
					to={paths.projects}
					current={projectsActive}
					open={mineOpen}
					onToggle={() => setMineOpen(!mineOpen)}
					trailing={
						<IconButton size={24} title="New folder" aria-label="New folder" onClick={() => actions.newProject()}>
							<IconPlus size={14} strokeWidth={2.2} />
						</IconButton>
					}
				/>
				{mineOpen ? (
					projects.isPending ? (
						<SkeletonStatus label="Loading folders…" className="flex flex-col" style={{ gap: 1 }}>
							{["62%", "48%", "70%"].map((width) => (
								<div key={width} className="flex items-center" style={{ gap: 10, height: 34, padding: "0 10px" }}>
									<Skeleton width={15} height={15} radius={4} />
									<Skeleton width={width} height={10} />
								</div>
							))}
						</SkeletonStatus>
					) : mine.length === 0 && projects.isSuccess ? (
						<p
							className="text-muted-2"
							style={{ padding: "14px 12px", fontSize: 13, lineHeight: 1.5, textWrap: "pretty" }}
						>
							No folders yet.{" "}
							<button
								type="button"
								onClick={() => actions.newProject()}
								className="text-ink underline underline-offset-[3px] hover:text-link-hover"
							>
								Create one
							</button>{" "}
							to group related files and give Connections scoped access.
						</p>
					) : (
						<nav aria-label="Folders" className={clsx("flex flex-col", dropZone)} style={{ gap: 1 }}>
							{mine.map(projectRow)}
						</nav>
					)
				) : null}
			</TopLevelDropSection>

			{projects.isError ? (
				<p role="alert" className="text-danger px-3 py-2 text-xs">
					{projects.error.message}
				</p>
			) : null}
		</div>
	)
}
