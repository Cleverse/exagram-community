import { type LibraryScope, type Project, type VisibleArtifact, type VisibleProject } from "@exagram/api-client"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"

import { useToast } from "@/components/Toast"
import { IconEllipsis, IconNewProject, IconShare, IconUpload } from "@/components/ui/icons"
import { Menu } from "@/components/ui/Menu"
import { SkeletonRows } from "@/components/ui/Skeleton"
import { UnderlineNav } from "@/components/ui/UnderlineNav"
import { edition } from "@/edition/edition"
import { AwaitingApprovalBlock } from "@/features/approvals/AwaitingApprovalBlock"
import { useMe } from "@/features/auth/hooks/useMe"
import { useProjectGrants } from "@/features/grants/hooks/useGrants"
import { ProjectShareDialog } from "@/features/grants/ShareDialog"
import { ArtifactList } from "@/features/library/ArtifactList"
import { ProjectRow } from "@/features/library/ArtifactRow"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useArtifactSelection } from "@/features/library/hooks/useArtifactSelection"
import { useListWidth } from "@/features/library/hooks/useListWidth"
import { useMissingPreviewRedirect } from "@/features/library/hooks/useMissingPreviewRedirect"
import { useProjects } from "@/features/library/hooks/useProjects"
import { useTallViewport } from "@/features/library/hooks/useViewport"
import { LibraryShell } from "@/features/library/LibraryShell"
import { HeaderAction, ListHeader } from "@/features/library/ListHeader"
import { isScrolled, pageHeaderSize } from "@/features/library/pageHeader"
import { previewNavFor } from "@/features/library/previewNav"
import { PreviewPane } from "@/features/library/PreviewPane"
import { SearchDialog } from "@/features/library/SearchDialog"
import { type SortKey, sortArtifacts } from "@/features/library/sort"
import { useLibraryActions, useRegisterArtifactSelect, useRegisterSearch } from "@/features/library/useLibraryActions"
import { useDeleteProject, useRenameProject } from "@/features/project/hooks/useProjectMutations"
import { MoveProjectDialog } from "@/features/project/MoveProjectDialog"
import { ProjectPeople } from "@/features/project/ProjectPeople"
import { ProjectRulesChip } from "@/features/project/ProjectRulesChip"
import { ProjectSettingsDialog } from "@/features/project/ProjectSettingsDialog"
import { paths, withPreview } from "@/routes/paths"

const SCOPE_TABS: { scope: LibraryScope; label: string; title: string; to: string }[] = [
	{ scope: "all", label: "All", title: "All artifacts", to: paths.library },
	{ scope: "sharedWithMe", label: "Shared with me", title: "Shared with me", to: paths.sharedWithMe },
	{ scope: "mine", label: "My uploads", title: "My uploads", to: paths.mine },
]

const newest = (artifacts: VisibleArtifact[]): Date | null => {
	let latest: number | null = null
	for (const artifact of artifacts) {
		const at = new Date(artifact.updatedAt).getTime()
		if (latest === null || at > latest) latest = at
	}
	return latest === null ? null : new Date(latest)
}

const Empty = ({ children }: { children: string }) => (
	<div style={{ padding: "64px 24px", textAlign: "center", color: "var(--color-muted)", fontSize: 15 }}>{children}</div>
)

/**
 * The prototype's copy names the members who would see a dropped file, so the Project's own grants
 * decide the sentence. Only a Project page renders this, which keeps the query off the library root.
 */
const ProjectEmptyMessage = ({ project }: { project: Project }) => {
	const grants = useProjectGrants(project.id)
	const members = (grants.data?.length ?? 0) + 1

	const note = members > 1 ? `this project's ${members} members will see it immediately.` : "only you will see it."
	return <Empty>{`No files here yet. Drop a file anywhere on this screen — ${note}`}</Empty>
}

/**
 * Screen 1: the library scopes and a Project page are the same screen — the Project page is the
 * library filtered to one Project, with two extra header rows (design lines 116–255). Activity is its
 * own screen (`features/activity`) that shares the shell and the content window.
 */
export const LibraryScreen = ({ scope, project }: { scope?: LibraryScope; project?: VisibleProject }) => {
	const activeScope = scope ?? "all"

	const [searchOpen, setSearchOpen] = useState(false)
	const openSearch = useCallback(() => setSearchOpen(true), [])
	const [sort, setSort] = useState<SortKey>("updated")
	const [editingSettings, setEditingSettings] = useState(false)
	const [shareOpen, setShareOpen] = useState(false)
	const [menu, setMenu] = useState<DOMRect | null>(null)
	const [renaming, setRenaming] = useState(false)
	const [moving, setMoving] = useState(false)

	const navigate = useNavigate()
	const location = useLocation()
	const toast = useToast()
	const actions = useLibraryActions()
	const me = useMe()
	const artifacts = useArtifacts(project ? { scope: "all", projectId: project.id } : { scope: activeScope })
	const projects = useProjects()
	const everything = useArtifacts({ scope: "all" })
	const sharedScope = useArtifacts({ scope: "sharedWithMe" })
	const mineScope = useArtifacts({ scope: "mine" })
	const rename = useRenameProject()
	const remove = useDeleteProject()

	const scopeCounts: Record<LibraryScope, number | undefined> = {
		all: everything.data?.length,
		sharedWithMe: sharedScope.data?.length,
		mine: mineScope.data?.length,
	}

	const listed = artifacts.data ?? []
	const availableArtifacts = [...listed, ...(everything.data ?? [])]
	const subfolders = project
		? (projects.data ?? []).filter((candidate) => candidate.parentProjectId === project.id)
		: []
	// A folder's breadcrumb names its parent, when the reader reaches it.
	const parentId = project?.parentProjectId ?? null
	const parent = parentId === null ? undefined : (projects.data ?? []).find((candidate) => candidate.id === parentId)

	// The sidebar's PINNED rows open the preview for an Artifact the open list may not hold.
	const selection = useArtifactSelection(availableArtifacts)
	useMissingPreviewRedirect(availableArtifacts, artifacts.isSuccess && everything.isSuccess)
	const listWidth = useListWidth()
	const listRef = useRef<HTMLDivElement>(null)
	const [scrolled, setScrolled] = useState(false)
	const headerSize = pageHeaderSize({ tall: useTallViewport(), scrolled })
	// The clicked row's place on screen, taken before the pane opens and narrows the list (which can rewrap
	// the head above it), so the scroll can put the row back where the pointer left it.
	const anchor = useRef<{ id: string; top: number } | null>(null)
	const selectRow = selection.select
	const select = useCallback(
		(artifactId: string | null) => {
			const row =
				artifactId === null
					? null
					: listRef.current?.querySelector<HTMLElement>(`[data-artifact-id="${CSS.escape(artifactId)}"]`)
			anchor.current = row && artifactId ? { id: artifactId, top: row.getBoundingClientRect().top } : null
			selectRow(artifactId)
		},
		[selectRow],
	)
	useRegisterArtifactSelect(select)
	useRegisterSearch(openSearch)
	// The design drops the Project and LAST ACTIVITY columns while the pane narrows the list (line 1886).
	const previewOpen = selection.selected !== null
	// A Project page can now be someone else's Project, shared with you.
	const isOwner = project !== undefined && project.ownerId === me.data?.id
	// My uploads are all mine, and a Project page's owner sits in its header, so only All and Shared with me
	// name each file's owner.
	const showOwner = !project && activeScope !== "mine" && !previewOpen

	useLayoutEffect(() => {
		const held = anchor.current
		const list = listRef.current
		if (!held || !list || selection.selectedId !== held.id) return
		anchor.current = null
		const row = list.querySelector<HTMLElement>(`[data-artifact-id="${CSS.escape(held.id)}"]`)
		if (row) list.scrollTop += row.getBoundingClientRect().top - held.top
	}, [selection.selectedId, previewOpen])

	// A link to `/?preview=<id>` for a file inside a Project the reader can open lands on that Project.
	// Only a landing moves: a click in the "All" list keeps the reader where they are.
	const landedProjectId =
		!project && selection.landed && selection.selected?.projectId
			? ((projects.data ?? []).find((candidate) => candidate.id === selection.selected?.projectId)?.id ?? null)
			: null
	useEffect(() => {
		if (landedProjectId === null || selection.requestedId === null) return
		void navigate(withPreview(paths.project(landedProjectId), location.search, selection.requestedId), {
			replace: true,
		})
	}, [landedProjectId, selection.requestedId, location.search, navigate])

	const missingPreviewId = artifacts.isSuccess && everything.isSuccess ? selection.missingPreviewId : null

	const projectNames = new Map((projects.data ?? []).map((candidate) => [candidate.id, candidate.name]))
	const open = selection.open

	const scopeTab = SCOPE_TABS.find((tab) => tab.scope === activeScope)
	const scopeTitle = scopeTab?.title ?? "All artifacts"
	const heading = project ? project.name : scopeTitle

	// The preview steps through the file's Project, or through this list in the order it is drawn.
	const nav = selection.selected
		? previewNavFor({
				artifact: selection.selected,
				everything: everything.data ?? [],
				projectNames,
				list: sortArtifacts(listed, sort),
				listFolder: project
					? { kind: "project", id: project.id, name: project.name }
					: { kind: "list", name: scopeTitle, href: scopeTab?.to ?? paths.library },
				sort,
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
			{missingPreviewId !== null ? null : (
				<>
					<ListHeader
						size={headerSize}
						itemCount={artifacts.isPending ? null : listed.length + subfolders.length}
						breadcrumb={
							project ? (
								<nav
									aria-label="Breadcrumb"
									className="flex min-w-0 items-center overflow-hidden whitespace-nowrap text-muted"
									style={{ gap: 6, fontSize: 14, marginBottom: 4 }}
								>
									<Link to={paths.projects} className="flex-none text-muted hover:text-ink">
										Projects
									</Link>
									<span className="flex-none">›</span>
									{parent ? (
										<>
											<Link to={paths.project(parent.id)} className="min-w-0 truncate text-muted hover:text-ink">
												{parent.name}
											</Link>
											<span className="flex-none">›</span>
										</>
									) : null}
									<span className="min-w-0 truncate text-body" aria-current="page">
										{project.name}
									</span>
								</nav>
							) : undefined
						}
						title={
							project && renaming ? (
								<input
									aria-label="Project name"
									autoFocus
									defaultValue={project.name}
									className="font-display w-full border border-line-soft bg-white px-2 outline-none focus:border-ink focus:shadow-[0_0_0_1px_var(--color-ink)]"
									style={{
										fontWeight: 700,
										fontSize: headerSize.fontSize,
										letterSpacing: headerSize.tracking,
									}}
									onKeyDown={(event) => {
										if (event.key === "Escape") setRenaming(false)
										if (event.key === "Enter") event.currentTarget.blur()
									}}
									onBlur={(event) => {
										const next = event.target.value.trim()
										setRenaming(false)
										if (next && next !== project.name) rename.mutate({ projectId: project.id, name: next })
									}}
								/>
							) : (
								heading
							)
						}
						onOpenSearch={openSearch}
						actions={
							<>
								{/* Only the Owner adds files to a Project (§A.3), so a shared Project's page offers no Upload. */}
								{!project || isOwner ? (
									<HeaderAction label="Upload" onClick={() => actions.upload()}>
										<IconUpload size={16} />
									</HeaderAction>
								) : null}
								{project ? (
									<>
										<HeaderAction label="Share" onClick={() => setShareOpen(true)}>
											<IconShare size={16} />
										</HeaderAction>
										<HeaderAction
											label="More actions"
											expanded={menu !== null}
											onClick={(event) => setMenu(event.currentTarget.getBoundingClientRect())}
										>
											<IconEllipsis size={16} />
										</HeaderAction>
									</>
								) : (
									<HeaderAction label="New project" onClick={() => actions.newProject()}>
										<IconNewProject size={16} />
									</HeaderAction>
								)}
							</>
						}
						// The rules card edits settings only the Owner can change, so only the Owner sees it; everyone
						// sees who owns the Project and who else reaches it.
						below={
							project ? (
								<div className="flex min-w-0 flex-wrap items-center" style={{ gap: "8px 16px" }}>
									{isOwner ? (
										<>
											<ProjectRulesChip project={project} onEdit={() => setEditingSettings(true)} />
											<span aria-hidden className="flex-none bg-row-line" style={{ width: 1, height: 20 }} />
										</>
									) : null}
									<ProjectPeople project={project} meId={me.data?.id} onOpenShare={() => setShareOpen(true)} />
								</div>
							) : undefined
						}
						tabs={
							project ? undefined : (
								// Each scope is its own address, so these are links; switching them does not animate.
								<UnderlineNav
									ariaLabel="Library scope"
									variant="scope"
									items={SCOPE_TABS.map((tab) => ({
										to: tab.to,
										label: tab.label,
										active: activeScope === tab.scope,
										count: scopeCounts[tab.scope] ?? "…",
									}))}
								/>
							)
						}
						listRows={{
							sort,
							onToggleSort: () => setSort(sort === "updated" ? "name" : "updated"),
							showProjectColumn: !project && !previewOpen,
							showOwnerColumn: showOwner,
							showMetaColumn: !previewOpen,
						}}
					/>

					<div
						ref={listRef}
						onScroll={(event) => setScrolled(isScrolled(event.currentTarget.scrollTop))}
						className="flex-1 overflow-auto"
						style={{ padding: "0 28px 48px" }}
					>
						{project?.sourceDescription ? (
							<p
								className="whitespace-pre-wrap"
								style={{ color: "var(--color-muted)", fontSize: 14, margin: "0 0 20px" }}
							>
								{project.sourceDescription}
							</p>
						) : null}
						<AwaitingApprovalBlock artifacts={project ? listed : (everything.data ?? [])} />

						{artifacts.isError ? (
							<p role="alert" className="text-danger p-4 text-sm">
								{artifacts.error.message}
							</p>
						) : null}

						{subfolders.length > 0 ? (
							<ul>
								{subfolders.map((child) => {
									const inside = (everything.data ?? []).filter((artifact) => artifact.projectId === child.id)
									return (
										<ProjectRow
											key={child.id}
											projectId={child.id}
											name={child.name}
											fileCount={inside.length}
											updatedAt={newest(inside) ?? child.createdAt}
											shared={inside.some((artifact) => artifact.sharedWithNames.length > 0)}
											showMeta={!previewOpen}
										/>
									)
								})}
							</ul>
						) : null}

						{listed.length === 0 && subfolders.length === 0 && !artifacts.isPending ? (
							project ? (
								<ProjectEmptyMessage project={project} />
							) : (
								<Empty>
									{
										"No files here yet. Drop a file anywhere on this screen — nobody else can see it until you invite them."
									}
								</Empty>
							)
						) : null}

						{artifacts.isPending ? <SkeletonRows label="Loading files…" showMeta={!previewOpen} /> : null}

						<ArtifactList
							artifacts={listed}
							sort={sort}
							flat={Boolean(project)}
							showProject={!project && !previewOpen}
							showOwner={showOwner}
							showMeta={!previewOpen}
							projectNames={projectNames}
							selectedId={selection.selectedId}
							onSelect={select}
							onOpen={open}
						/>
					</div>
				</>
			)}

			{searchOpen ? (
				<SearchDialog
					artifacts={project ? listed : (everything.data ?? [])}
					projects={projects.data ?? []}
					projectId={project?.id ?? null}
					onClose={() => setSearchOpen(false)}
					onOpenArtifact={open}
				/>
			) : null}

			{editingSettings && project ? (
				<ProjectSettingsDialog mode="edit" projectId={project.id} onClose={() => setEditingSettings(false)} />
			) : null}

			{moving && project ? <MoveProjectDialog project={project} onClose={() => setMoving(false)} /> : null}

			{shareOpen && project ? (
				<ProjectShareDialog projectId={project.id} projectName={project.name} onClose={() => setShareOpen(false)} />
			) : null}

			{menu && project ? (
				<Menu
					anchor={menu}
					ariaLabel={project.name}
					onClose={() => setMenu(null)}
					items={[
						{ label: "Open", onSelect: () => setMenu(null) },
						...edition.openInAppItems(paths.project(project.id), () => setMenu(null)),
						{
							label: "Share…",
							onSelect: () => {
								setMenu(null)
								setShareOpen(true)
							},
						},
						// The server keeps settings, rename, sub-projects and delete to the Owner, so only the Owner sees them.
						...(isOwner
							? [
									{
										label: "Settings…",
										onSelect: () => {
											setMenu(null)
											setEditingSettings(true)
										},
									},
									{
										label: "Rename",
										onSelect: () => {
											setMenu(null)
											setRenaming(true)
										},
									},
									{
										label: "New sub-project",
										onSelect: () => {
											setMenu(null)
											actions.newProject(project.id)
										},
									},
									{
										label: "Move to…",
										onSelect: () => {
											setMenu(null)
											setMoving(true)
										},
									},
									{
										label: "Delete",
										color: "var(--color-danger)",
										onSelect: () => {
											setMenu(null)
											remove.mutate(
												{ projectId: project.id },
												{
													onSuccess: () => void navigate(paths.library),
													onError: (error) => toast(error.message),
												},
											)
										},
									},
								]
							: []),
					]}
				/>
			) : null}
		</LibraryShell>
	)
}
