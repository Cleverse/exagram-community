import { type VisibleArtifact, type VisibleProject } from "@exagram/api-client"
import { type ReactNode } from "react"
import { Link, Navigate, useLocation, useParams } from "react-router"

import { HeaderIconButton, MobileScreen, NewFab, PushHeader } from "@/components/mobile/primitives"
import { MobileFileRow, MobileProjectRow } from "@/components/mobile/rows"
import { useSheet } from "@/components/mobile/sheet/context"
import { NotFound } from "@/components/NotFound"
import { IconEllipsis, IconPeoplePlus, IconShield } from "@/components/ui/icons"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { edition } from "@/edition/edition"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { useMe } from "@/features/auth/hooks/useMe"
import { useProjectAccess, useProjectGrants } from "@/features/grants/hooks/useGrants"
import { isGroupGrant, whoLabel } from "@/features/grants/useShareModel"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useMissingPreviewRedirect } from "@/features/library/hooks/useMissingPreviewRedirect"
import { useProjects } from "@/features/library/hooks/useProjects"
import { summarizeProjects } from "@/features/library/projectSummary"
import { sortArtifacts } from "@/features/library/sort"
import { hasProjectRules } from "@/features/project/projectRules"
import { publishPolicyLabel } from "@/features/project/publishPolicy"
import { useWorkspaceOf } from "@/features/workspace/useWorkspaceKind"
import { useProjectSettings } from "@/mock/projectSettings"
import { paths, previewIdOf } from "@/routes/paths"
import { initialsOf } from "@/utils/initials"

/**
 * Back goes up, never through history: to the folder this Project sits in, or to Projects for a top-level one,
 * named for where it goes. A parent the reader can't list counts as no parent.
 */
const upOf = (project: VisibleProject | undefined, projects: VisibleProject[]): { to: string; label: string } => {
	const parent = project?.parentProjectId
		? projects.find((candidate) => candidate.id === project.parentProjectId)
		: undefined
	return parent ? { to: paths.project(parent.id), label: parent.name } : { to: paths.projects, label: "Folders" }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The overlapping 26px initials: a 2px white ring, each tucked 6px under the next. */
const AvatarStack = ({ names }: { names: string[] }) => (
	<div className="flex" aria-hidden>
		{names.map((name, index) => (
			<span
				key={`${name}-${index}`}
				className="grid place-items-center border-2 border-panel bg-subtle text-ink"
				style={{
					width: 26,
					height: 26,
					borderRadius: "50%",
					marginRight: -6,
					fontSize: 10,
					fontWeight: 600,
				}}
			>
				{initialsOf(name, undefined)}
			</span>
		))}
	</div>
)

/**
 * Who is on the Project and the meta line beside them: "Shared · N people · N files".
 * The grant list is asked for only by someone the server lets manage access, as the Share dialog does; anyone
 * else sees the file count alone, since the member count is not theirs to read.
 */
const People = ({ project, files }: { project: VisibleProject; files: VisibleArtifact[] }) => {
	const me = useMe()
	const access = useProjectAccess(project.id)
	const canList = access.data === "owner" || access.data === "edit" || access.data === "collaborate"
	const grants = useProjectGrants(project.id, canList)
	const fileCount = plural(files.length, "file", "files")

	if (!canList || !grants.data) {
		return (
			<div className="text-muted" style={{ marginTop: 10, fontSize: 13 }}>
				{fileCount}
			</div>
		)
	}

	// The grant list leaves out the Owner. Their name is the reader's own, or on a file they uploaded here.
	const ownerName =
		project.ownerId === me.data?.id
			? me.data.name
			: files.find((artifact) => artifact.ownerId === project.ownerId)?.ownerName
	const persons = grants.data.filter((grant) => !isGroupGrant(grant))
	const groups = grants.data.length - persons.length
	const names = [...(ownerName ? [ownerName] : []), ...persons.map((grant) => grant.granteeName)].slice(0, 5)
	const shared = grants.data.length > 0 || project.ownerId !== me.data?.id

	return (
		<div className="flex items-center" style={{ gap: 10, marginTop: 10 }}>
			<AvatarStack names={names} />
			<span className="text-muted" style={{ fontSize: 13, marginLeft: 6 }}>
				{`${shared ? "Shared · " : ""}${whoLabel(persons.length + 1, groups)} · ${fileCount}`}
			</span>
		</div>
	)
}

/**
 * The Project rules card: the policy clamped to two lines and the publishing mode, opening the Rules
 * drawer. Like desktop's rules chip it is the Owner's alone: the policy text is still kept in the Owner's browser
 * (`useProjectSettings`), so anyone else would read "No policy" where there is one.
 */
const RulesCard = ({ project, onOpen }: { project: VisibleProject; onOpen: () => void }) => {
	const settings = useProjectSettings(project.id)
	const { kind } = useWorkspaceOf(project.workspaceId)
	const personal = kind === "personal"
	const policy = settings.policy.trim()
	if (!hasProjectRules(kind)) return null
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full flex-col border border-line text-left active:bg-row-hover"
			style={{ marginTop: 14, borderRadius: 10, padding: "12px 14px", gap: 6 }}
		>
			<span className="flex w-full items-center" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>
				<IconShield size={15} className="text-secondary" />
				<span className="flex-1">Folder rules</span>
				{personal ? null : (
					<span className="text-muted-2" style={{ fontWeight: 400, fontSize: 12.5 }}>
						{publishPolicyLabel(project.publishPolicy)}
					</span>
				)}
			</span>
			{edition.projectRules ? (
				<span
					className="text-muted"
					style={{
						fontSize: 13,
						lineHeight: 1.45,
						display: "-webkit-box",
						WebkitLineClamp: 2,
						WebkitBoxOrient: "vertical",
						overflow: "hidden",
					}}
				>
					{policy || "No policy yet. Connections read this folder with Workspace defaults."}
				</span>
			) : null}
		</button>
	)
}

/** "Projects › Parent › Name": every step but the last goes back up. */
const Breadcrumb = ({ project, projects }: { project: VisibleProject; projects: VisibleProject[] }) => {
	const byId = new Map(projects.map((candidate) => [candidate.id, candidate]))
	const chain: VisibleProject[] = []
	let parentId = project.parentProjectId
	while (parentId !== null && !chain.some((step) => step.id === parentId)) {
		const parent = byId.get(parentId)
		if (!parent) break
		chain.unshift(parent)
		parentId = parent.parentProjectId
	}
	const crumbs: ReactNode[] = [
		<Link key="all" to={paths.projects} className="flex-none text-muted-2 hover:text-muted-2">
			Folders
		</Link>,
		...chain.map((step) => (
			<Link key={step.id} to={paths.project(step.id)} className="min-w-0 truncate text-muted-2 hover:text-muted-2">
				{step.name}
			</Link>
		)),
		<span key="here" aria-current="page" className="min-w-0 truncate">
			{project.name}
		</span>,
	]
	return (
		<nav
			aria-label="Breadcrumb"
			className="flex min-w-0 items-center overflow-hidden whitespace-nowrap text-muted-2"
			style={{ gap: 5, fontSize: 12.5 }}
		>
			{crumbs.flatMap((crumb, index) =>
				index === 0
					? [crumb]
					: [
							<span key={`sep-${index}`} className="flex-none" aria-hidden>
								›
							</span>,
							crumb,
						],
			)}
		</nav>
	)
}

const LoadingBody = () => (
	<SkeletonStatus label="Loading folder…" style={{ padding: "16px 16px 0" }}>
		<Skeleton width={120} height={11} />
		<Skeleton width="62%" height={22} style={{ marginTop: 10 }} />
		<Skeleton width="44%" height={12} style={{ marginTop: 14 }} />
	</SkeletonStatus>
)

const ProjectBody = ({ project, projects }: { project: VisibleProject; projects: VisibleProject[] }) => {
	const sheet = useSheet()
	const me = useMe()
	const listed = useArtifacts({ scope: "all", projectId: project.id })
	const everything = useArtifacts({ scope: "all" })
	const pending = usePendingRevisions()

	const files = sortArtifacts(listed.data ?? [], "updated")
	const subfolders = projects.filter((candidate) => candidate.parentProjectId === project.id)
	const { countFor, isShared } = summarizeProjects(projects, everything.data ?? [], me.data?.id)
	const waiting = new Set((pending.data ?? []).map((revision) => revision.artifactId))

	return (
		<>
			<div style={{ padding: "16px 16px 0" }}>
				<Breadcrumb project={project} projects={projects} />
				<h1
					style={{
						margin: "4px 0 0",
						fontSize: 22,
						fontWeight: 700,
						letterSpacing: "-.012em",
						lineHeight: 1.25,
						textWrap: "pretty",
					}}
				>
					{project.name}
				</h1>
				<People project={project} files={listed.data ?? []} />
				{project.ownerId === me.data?.id ? (
					<RulesCard project={project} onOpen={() => sheet.open("rules", { projectId: project.id })} />
				) : null}
			</div>

			<div
				className="flex items-center border-b border-row-line text-muted-2"
				style={{ margin: "0 16px 4px", padding: "18px 0 6px", fontSize: 13 }}
			>
				<span className="flex-1" style={{ fontWeight: 500 }}>
					Updated ↑
				</span>
				<span className="font-mono" style={{ fontSize: 12 }}>
					{listed.isSuccess ? plural(files.length, "file", "files") : null}
				</span>
			</div>

			<div style={{ padding: "0 6px" }}>
				{subfolders.map((child) => (
					<MobileProjectRow
						key={child.id}
						projectId={child.id}
						name={child.name}
						count={countFor(child.id)}
						shared={isShared(child)}
					/>
				))}

				{listed.isError ? (
					<p role="alert" className="text-danger" style={{ padding: "16px 10px", fontSize: 14 }}>
						{listed.error.message}
					</p>
				) : null}

				{listed.isPending ? (
					<SkeletonStatus label="Loading files…" style={{ padding: "6px 10px" }}>
						{["62%", "48%", "70%"].map((width) => (
							<div key={width} className="flex items-center" style={{ gap: 12, height: 56 }}>
								<Skeleton width={30} height={30} radius={6} />
								<Skeleton width={width} height={12} />
							</div>
						))}
					</SkeletonStatus>
				) : null}

				{files.map((artifact) => (
					<MobileFileRow
						key={artifact.id}
						artifact={artifact}
						projectName={project.name}
						pending={waiting.has(artifact.id)}
						onMore={() => sheet.open("file", { artifactId: artifact.id })}
					/>
				))}

				{listed.isSuccess && files.length === 0 && subfolders.length === 0 ? (
					<div
						className="text-muted"
						style={{ padding: "40px 16px", textAlign: "center", fontSize: 14, textWrap: "pretty" }}
					>
						No files yet. Upload one, or ask a Connection to publish here.
					</div>
				) : null}
			</div>
		</>
	)
}

/**
 * Screen 3 on a phone: a pushed screen with Back named for where it returns, Share and
 * the Project drawer; the title, who is on it, the rules card, subfolders and files; New creates inside it.
 */
export default function ProjectPageMobile() {
	const { projectId = "" } = useParams()
	const location = useLocation()
	const sheet = useSheet()
	const projects = useProjects()
	const everything = useArtifacts({ scope: "all" })
	const project = projects.data?.find((candidate) => candidate.id === projectId)
	const up = upOf(project, projects.data ?? [])
	useMissingPreviewRedirect(everything.data, Boolean(project) && everything.isSuccess)
	const previewId = previewIdOf(location.search)
	if (!project && projects.isSuccess && previewId !== null) return <Navigate replace to={paths.artifact(previewId)} />

	const actions = project ? (
		<>
			<HeaderIconButton
				label="Share"
				onClick={() => sheet.open("share", { target: { kind: "project", id: projectId } })}
			>
				<IconPeoplePlus size={20} />
			</HeaderIconButton>
			<HeaderIconButton label="More actions" onClick={() => sheet.open("project", { projectId })}>
				<IconEllipsis size={20} />
			</HeaderIconButton>
		</>
	) : null

	return (
		<MobileScreen
			push
			label={project?.name ?? "Folder"}
			header={<PushHeader to={up.to} backLabel={up.label} actions={actions} />}
			bodyStyle={{ paddingBottom: project ? 96 : 40 }}
			fab={project ? <NewFab onClick={() => sheet.open("new", { projectId })} /> : undefined}
		>
			{project && edition.OpenInAppBanner ? <edition.OpenInAppBanner /> : null}
			{project ? (
				<ProjectBody project={project} projects={projects.data ?? []} />
			) : projects.isPending ? (
				<LoadingBody />
			) : (
				<NotFound what="folder" />
			)}
		</MobileScreen>
	)
}
