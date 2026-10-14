import { type VisibleArtifact } from "@exagram/api-client"
import clsx from "clsx"
import { type CSSProperties, type ReactNode, useState } from "react"
import { Link, useNavigate } from "react-router"

import { useToast } from "@/components/Toast"
import { Avatar } from "@/components/ui/Avatar"
import { IconButton } from "@/components/ui/IconButton"
import { IconEllipsis, IconLink, IconPeople, IconPin, IconShare } from "@/components/ui/icons"
import { Menu } from "@/components/ui/Menu"
import { ThinkingMatrix } from "@/components/ui/ThinkingMatrix"
import { TypeIcon } from "@/components/ui/TypeIcon"
import { TypeTile } from "@/components/ui/TypeTile"
import { edition } from "@/edition/edition"
import { artifactLinkTarget, openArtifact } from "@/features/artifact/openArtifact"
import { copyArtifactLink } from "@/features/artifact/useArtifactActions"
import { useMe } from "@/features/auth/hooks/useMe"
import { ShareDialog } from "@/features/grants/ShareDialog"
import { setDragGhost } from "@/features/library/dragGhost"
import { useDragState } from "@/features/library/dragState"
import { DROP_TARGET_CLASS, useFolderDrop, useProjectDrag } from "@/features/library/hooks/useFolderDrop"
import { usePinned } from "@/features/library/hooks/usePinned"
import { isIndexing } from "@/features/library/indexing"
import { ARTIFACT_DRAG_TYPE, KIND_TAG } from "@/features/library/kinds"
import { activityWhen, lastActivity } from "@/features/library/lastActivity"
import { useDeleteArtifact } from "@/features/project/hooks/useProjectMutations"
import { MoveArtifactDialog } from "@/features/project/MoveArtifactDialog"
import { paths } from "@/routes/paths"
import { initialsOf } from "@/utils/initials"

/** The row shell every list row is drawn with: 44px, `0 10px`, 6px radius, no divider. */
const ROW_STYLE: CSSProperties = {
	position: "relative",
	gap: 12,
	height: 44,
	padding: "0 10px",
	margin: "1px 0",
	borderRadius: "var(--radius)",
}

/**
 * Selected rows take the `row-selected` fill (v3); the rest take the opaque `row-hover` wash on hover, and
 * keep it while focus is inside them, so the action strip can fade into exactly that colour. No left bar.
 */
const rowClass = (selected: boolean, lit = false) =>
	clsx(
		"flex cursor-pointer items-center transition-colors duration-(--duration-row) ease-(--ease-arrive)",
		selected ? "bg-row-selected" : lit ? "bg-row-hover" : "hover:bg-row-hover",
	)

const NameCell = ({ children }: { children: ReactNode }) => (
	<div className="flex min-w-0 flex-1 items-center" style={{ gap: 6 }}>
		{children}
	</div>
)

/** The 14px shared mark after a name, named for screen readers. */
const SharedMark = () => (
	<>
		<IconPeople size={14} className="flex-none text-muted" />
		<span className="sr-only">Shared</span>
	</>
)

/** The Owner cell: a 24px initials avatar centred in its 56px column; hover names the owner. */
const OwnerCell = ({ name }: { name: string }) => (
	<div className="flex flex-none justify-center" style={{ width: 56 }}>
		<Avatar
			initials={initialsOf(name, undefined)}
			size={24}
			background="var(--color-row-line)"
			color="var(--color-ink)"
			title={name}
		/>
	</div>
)

/** The Last activity cell: 12px, right-aligned in its 120px column. */
const MetaCell = ({ children }: { children: string }) => (
	<div className="flex-none text-right whitespace-nowrap text-muted" style={{ fontSize: 12, width: 120 }}>
		{children}
	</div>
)

export const ArtifactRow = ({
	artifact,
	selected,
	onSelect,
	onOpen,
	showProject,
	showOwner,
	showMeta = true,
	projectName,
}: {
	artifact: VisibleArtifact
	selected?: boolean
	onSelect?: (artifactId: string) => void
	onOpen?: (artifactId: string) => void
	/** The library root carries a Project column; inside a Project it would repeat the header. */
	showProject?: boolean
	/** The Owner column, for the scopes that list other people's files (All, Shared with me). */
	showOwner?: boolean
	/** The avatars and LAST ACTIVITY cells; hidden while the preview pane narrows the list (design line 1886). */
	showMeta?: boolean
	projectName?: string | null
}) => {
	const projectId = artifact.projectId
	const navigate = useNavigate()
	const toast = useToast()
	const me = useMe()
	const pinned = usePinned()
	const remove = useDeleteArtifact()
	const drag = useDragState()
	// The row being dragged fades to .45 until the drag ends.
	const beingDragged = drag.dragged?.id === artifact.id
	const [hovered, setHovered] = useState(false)
	const [focused, setFocused] = useState(false)
	const [menu, setMenu] = useState<{ kind: "actions"; anchor: DOMRect } | null>(null)
	const [shareOpen, setShareOpen] = useState(false)
	const [moveOpen, setMoveOpen] = useState(false)

	const isPinned = pinned.isPinned(artifact.id)
	const open = () => {
		if (onOpen) onOpen(artifact.id)
		else openArtifact(navigate, artifact.id)
	}

	const copyLink = () => void copyArtifactLink(artifact.id, toast)

	const togglePin = () => {
		pinned.toggle(artifact.id)
		toast(isPinned ? "Unpinned." : "Pinned — shows in the sidebar for everyone who can see it.")
	}

	// Focus reveals the same actions hover does, so Tab reaches Share, copy-link, pin and the menu. The selected
	// row has the pane beside it, which carries all of them, so its strip stays hidden.
	const showActions = (hovered || focused || menu !== null) && selected !== true

	return (
		<li
			draggable
			onDragStart={(event) => {
				event.dataTransfer.setData(ARTIFACT_DRAG_TYPE, artifact.id)
				event.dataTransfer.effectAllowed = "move"
				setDragGhost(event, artifact)
				drag.setDragged(artifact)
			}}
			onDragEnd={() => drag.setDragged(null)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setFocused(true)}
			onBlur={(event) => {
				if (event.currentTarget.contains(event.relatedTarget)) return
				setFocused(false)
			}}
			onClick={onSelect ? () => onSelect(artifact.id) : undefined}
			onDoubleClick={() => open()}
			data-selected={selected === true || undefined}
			data-artifact-id={artifact.id}
			className={rowClass(selected === true, showActions)}
			style={{ ...ROW_STYLE, opacity: beingDragged ? 0.45 : undefined }}
		>
			<TypeTile kind={artifact.kind} />

			<NameCell>
				{/* The row's keyboard entry point: a real link, so Tab reaches it and Enter opens the Artifact. */}
				<Link
					to={paths.artifact(artifact.id)}
					target={artifactLinkTarget()}
					className="min-w-0 truncate text-ink hover:text-ink"
					style={{ fontSize: 14, fontWeight: 450 }}
					onClick={(event) => {
						event.stopPropagation()
						// ⌘/Ctrl/Shift-click is the browser's "open elsewhere"; the Mac app turns ⌘-click into a tab.
						if (!onSelect || event.metaKey || event.ctrlKey || event.shiftKey) return
						// The prototype selects on a single click and only opens on a double click, so the
						// name must not navigate while the row is selectable.
						event.preventDefault()
						onSelect(artifact.id)
					}}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || !onOpen) return
						// Stops the browser turning Enter into a click, which would navigate twice.
						event.preventDefault()
						event.stopPropagation()
						onOpen(artifact.id)
					}}
				>
					{artifact.title}
				</Link>
				{/* The tile spells the kind, so the visible tag beside the name is gone; it is read out only. */}
				<span className="sr-only">{KIND_TAG[artifact.kind]}</span>
				{artifact.sharedWithNames.length > 0 ? <SharedMark /> : null}
				{isIndexing(artifact) ? <ThinkingMatrix /> : null}
			</NameCell>

			{showProject ? (
				<div className="flex min-w-0 flex-none justify-start" style={{ width: 170 }}>
					{projectId !== null && projectName ? (
						<button
							type="button"
							className="max-w-full truncate text-left text-muted hover:text-link-hover"
							style={{ fontSize: 13 }}
							onClick={(event) => {
								event.stopPropagation()
								void navigate(paths.project(projectId))
							}}
						>
							{projectName}
						</button>
					) : null}
				</div>
			) : null}

			{showOwner ? <OwnerCell name={artifact.ownerName} /> : null}

			{showMeta ? (
				<MetaCell>
					{lastActivity({ updatedAt: artifact.updatedAt, ownerId: artifact.ownerId, meId: me.data?.id })}
				</MetaCell>
			) : null}

			{showActions ? (
				<div
					className="absolute top-0 right-0 flex items-center"
					style={{
						bottom: 0,
						gap: 2,
						padding: "0 8px 0 40px",
						borderRadius: "0 var(--radius) var(--radius) 0",
						// The row is lit whenever the strip shows (hover or focus; a selected row carries its actions in the
						// pane), so the fade ends in the row's own colour and leaves no seam. Opacity only: a rise would
						// spill over the row below.
						background: "linear-gradient(90deg, transparent, var(--color-row-hover) 40px)",
						animation: "fadeIn var(--duration-panel) var(--ease-arrive)",
					}}
					onClick={(event) => event.stopPropagation()}
					onDoubleClick={(event) => event.stopPropagation()}
				>
					<IconButton title="Share" aria-label="Share" onClick={() => setShareOpen(true)}>
						<IconShare size={16} />
					</IconButton>
					<IconButton size={36} title="Copy link" aria-label="Copy link" onClick={copyLink}>
						<IconLink size={17} />
					</IconButton>
					{edition.pins ? (
						<IconButton
							size={36}
							title="Pin"
							aria-label={isPinned ? `Unpin ${artifact.title}` : `Pin ${artifact.title}`}
							aria-pressed={isPinned}
							onClick={togglePin}
							className={isPinned ? "text-ink" : undefined}
						>
							<IconPin size={17} fill={isPinned ? "currentColor" : "none"} />
						</IconButton>
					) : null}
					<IconButton
						size={36}
						aria-label={`More actions for ${artifact.title}`}
						aria-expanded={menu !== null}
						onClick={(event) => setMenu({ kind: "actions", anchor: event.currentTarget.getBoundingClientRect() })}
					>
						<IconEllipsis size={18} />
					</IconButton>
				</div>
			) : null}

			{menu?.kind === "actions" ? (
				<Menu
					anchor={menu.anchor}
					ariaLabel={artifact.title}
					onClose={() => setMenu(null)}
					items={[
						{ label: "Open", onSelect: () => open() },
						{
							label: "Share…",
							onSelect: () => {
								setMenu(null)
								setShareOpen(true)
							},
						},
						{
							label: "Move to folder…",
							onSelect: () => {
								setMenu(null)
								setMoveOpen(true)
							},
						},
						{
							label: "Delete",
							color: "var(--color-danger)",
							onSelect: () => {
								setMenu(null)
								remove.mutate(
									{ artifactId: artifact.id },
									{
										onSuccess: () => toast(edition.copy.deleteArtifact.done(artifact.title)),
										onError: (error) => toast(error.message),
									},
								)
							},
						},
					]}
				/>
			) : null}
			{moveOpen ? (
				<MoveArtifactDialog
					artifactId={artifact.id}
					title={artifact.title}
					currentProjectId={artifact.projectId}
					onClose={() => setMoveOpen(false)}
				/>
			) : null}

			{shareOpen ? <ShareDialog artifact={artifact} onClose={() => setShareOpen(false)} /> : null}
		</li>
	)
}

/**
 * A Project drawn as a row: the design's folder, used for the subfolders a Project page lists above
 * its files. Same row shell, and per the prototype a folder keeps its meta cell on hover instead of
 * swapping in row actions — a folder is renamed, shared or deleted from its own page's ⋯ menu.
 */
export const ProjectRow = ({
	projectId,
	name,
	fileCount,
	updatedAt,
	shared,
	showMeta = true,
}: {
	projectId: string
	name: string
	fileCount: number
	updatedAt: Date | string | null
	shared: boolean
	showMeta?: boolean
}) => {
	const navigate = useNavigate()
	// A folder row takes a file row dropped on it (a move) or a desktop file (an upload into it). Its Owner can
	// drag it onto another Project in the sidebar, or onto FOLDERS to make it top-level.
	const { over, dropHandlers } = useFolderDrop<HTMLLIElement>({ projectId })
	const { beingDragged, dragHandlers } = useProjectDrag(projectId)

	return (
		<li
			onClick={() => void navigate(paths.project(projectId))}
			{...dropHandlers}
			{...dragHandlers}
			className={clsx(rowClass(false), over && DROP_TARGET_CLASS)}
			style={{ ...ROW_STYLE, opacity: beingDragged ? 0.45 : undefined }}
		>
			<TypeIcon kind="folder" size={24} />

			<NameCell>
				{/* The row's keyboard entry point; the surrounding row stays clickable for the mouse. */}
				<Link
					to={paths.project(projectId)}
					className="min-w-0 truncate text-ink hover:text-ink"
					style={{ fontSize: 14, fontWeight: 450 }}
					onClick={(e) => e.stopPropagation()}
				>
					{name}
				</Link>
				{shared ? <SharedMark /> : null}
			</NameCell>

			{showMeta ? (
				<MetaCell>{`${fileCount === 1 ? "1 file" : `${fileCount} files`} · ${updatedAt === null ? "—" : activityWhen(updatedAt)}`}</MetaCell>
			) : null}
		</li>
	)
}
