import { type VisibleArtifact } from "@exagram/api-client"
import clsx from "clsx"
import { type ButtonHTMLAttributes, type CSSProperties, type Ref, useEffect, useRef, useState } from "react"
import { useLocation, useSearchParams } from "react-router"

import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { IconButton, type IconButtonProps } from "@/components/ui/IconButton"
import {
	IconArrowLeft,
	IconChevronDown,
	IconClose,
	IconEllipsis,
	IconHistory,
	IconInfo,
	IconLink,
	IconMaximize,
	IconPin,
} from "@/components/ui/icons"
import { Menu, type MenuItem } from "@/components/ui/Menu"
import { SkeletonText } from "@/components/ui/Skeleton"
import { ThinkingMatrix } from "@/components/ui/ThinkingMatrix"
import { TypeTile } from "@/components/ui/TypeTile"
import { edition } from "@/edition/edition"
import { useBodyToken, usePreviewToken } from "@/features/artifact/hooks/useArtifact"
import { useReadingRevision } from "@/features/artifact/hooks/useReadingRevision"
import { PendingBanner } from "@/features/artifact/PendingBanner"
import { HtmlFrame, ImageFrame, OfficeFrame, PdfFrame, ScaledFrame } from "@/features/artifact/reading/BodyFrames"
import { editedLabel } from "@/features/artifact/reading/format"
import { HistoryDialog } from "@/features/artifact/reading/HistoryDialog"
import { ReadingBody } from "@/features/artifact/reading/ReadingBody"
import { type PanelTab, SidePanel, type SideTab } from "@/features/artifact/reading/SidePanel"
import { DEFAULT_PREVIEW_ZOOM, PREVIEW_ZOOM_OPTIONS } from "@/features/artifact/reading/zoom"
import { useArtifactActions } from "@/features/artifact/useArtifactActions"
import { UseInClaude } from "@/features/artifact/UseInClaude"
import { useMe } from "@/features/auth/hooks/useMe"
import { useConnections } from "@/features/connections/hooks/useConnections"
import { ShareDialog } from "@/features/grants/ShareDialog"
import { LIST_MIN_WIDTH, type ListWidth } from "@/features/library/hooks/useListWidth"
import { usePinned } from "@/features/library/hooks/usePinned"
import { useProjects } from "@/features/library/hooks/useProjects"
import { useSharedPeople } from "@/features/library/hooks/useSharedPeople"
import { usePresentFitsPane } from "@/features/library/hooks/useViewport"
import { isIndexing } from "@/features/library/indexing"
import { KIND_TAG } from "@/features/library/kinds"
import { paneFrame } from "@/features/library/paneLayout"
import { crumbsFor, PathMenu } from "@/features/library/PathMenu"
import { PresentMode } from "@/features/library/PresentMode"
import { composePreviewMenuItems } from "@/features/library/previewMenu"
import { type FolderRef } from "@/features/library/previewNav"
import { SharedAvatars } from "@/features/library/SharedAvatars"
import { LinkDialog } from "@/features/links/LinkDialog"
import { NewRevisionBar } from "@/features/live/NewRevisionBar"
import { useHeldRevision } from "@/features/live/useHeldRevision"
import { macTabs } from "@/features/notifications/macBridge"
import { paths } from "@/routes/paths"

const POPOVER_SHADOW = "var(--shadow-menu)"

const REDACTION_POPOVER_WIDTH = 400

/** Opened from the ⋯ menu's "Redaction…"; sits under the ⋯ button the same way the menu did. */
const RedactionPopover = ({
	artifactId,
	anchor,
	onClose,
}: {
	artifactId: string
	anchor: DOMRect
	onClose: () => void
}) => {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			// Claimed, so the window-level Escape (full view, then the pane) leaves it alone.
			event.preventDefault()
			onClose()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [onClose])

	const left = Math.max(
		16,
		Math.min(anchor.right - REDACTION_POPOVER_WIDTH, window.innerWidth - REDACTION_POPOVER_WIDTH - 16),
	)

	return (
		<>
			<div onClick={onClose} className="fixed inset-0" style={{ zIndex: 40 }} />
			<div
				role="dialog"
				aria-label="Redaction"
				className="fixed"
				style={{
					zIndex: 41,
					left,
					top: anchor.bottom + 6,
					width: REDACTION_POPOVER_WIDTH,
					maxWidth: "calc(100vw - 32px)",
					background: "var(--color-panel)",
					border: "1px solid var(--color-line-faint)",
					borderRadius: "var(--radius)",
					boxShadow: POPOVER_SHADOW,
					padding: "16px 18px",
					animation: "fadeUp .16s ease",
				}}
			>
				{edition.ArtifactRedactionSection && <edition.ArtifactRedactionSection artifactId={artifactId} />}
			</div>
		</>
	)
}

/**
 * Row 1's icon buttons (v3.2 prototype): 30px, `secondary` glyphs, hover `hover`. The colour is inline, since a
 * second text class would fight `IconButton`'s own; `ink` is the pinned pin.
 */
const HeaderIconButton = ({ ink = false, style, ...rest }: IconButtonProps & { ink?: boolean }) => (
	<IconButton
		size={32}
		style={{ width: 30, height: 30, color: ink ? "var(--color-ink)" : "var(--color-secondary)", ...style }}
		{...rest}
	/>
)

/**
 * The small icon buttons inside the title block (v3.6 §2): pin and copy link after the title at 26px with
 * 15px glyphs, Details and History on the meta line at 22px with 14px glyphs.
 */
const InlineIconButton = ({
	size,
	active = false,
	className,
	style,
	type = "button",
	...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
	size: 22 | 26
	active?: boolean
	ref?: Ref<HTMLButtonElement>
	style?: CSSProperties
}) => (
	<button
		type={type}
		className={clsx(
			"press grid flex-none place-items-center hover:bg-hover hover:text-ink",
			active ? "text-ink" : size === 22 ? "text-muted" : "text-secondary",
			className,
		)}
		style={{ width: size, height: size, borderRadius: size === 22 ? 5 : "var(--radius)", ...style }}
		{...rest}
	/>
)

/** The 1×16 rule between the header's tools and its avatars · Present · Share group; full view only. */
const RowDivider = () => (
	<div aria-hidden className="flex-none" style={{ width: 1, height: 16, background: "var(--color-line)" }} />
)

/** Keys typed into these belong to the field, never to the pane's previous / next. */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/**
 * The zoom picker (v3.2 prototype): the mono `110%` and a ▾ that opens the nine steps as a
 * `Menu` of checked items, so it has the menu's keyboard model — arrows, Home / End, Escape, and focus back
 * on the button. The pane does not step zoom in ones like the reading toolbar does.
 */
const ZoomMenu = ({ value, onChange }: { value: number; onChange: (next: number) => void }) => {
	const [anchor, setAnchor] = useState<DOMRect | null>(null)

	return (
		<>
			<button
				type="button"
				aria-label="Zoom"
				aria-haspopup="menu"
				aria-expanded={anchor !== null}
				onClick={(event) => setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect())}
				title="Zoom"
				className={clsx(
					"press font-mono flex flex-none items-center whitespace-nowrap text-secondary",
					anchor ? "bg-subtle" : "hover:bg-hover",
				)}
				style={{ gap: 3, height: 30, padding: "0 8px", fontSize: 12 }}
			>
				{value}%
				<IconChevronDown size={12} strokeWidth={2.4} />
			</button>
			{anchor ? (
				<Menu
					anchor={anchor}
					ariaLabel="Zoom level"
					width={120}
					onClose={() => setAnchor(null)}
					items={PREVIEW_ZOOM_OPTIONS.map((option) => ({
						label: `${option}%`,
						checked: option === value,
						onSelect: () => {
							setAnchor(null)
							onChange(option)
						},
					}))}
				/>
			) : null}
		</>
	)
}

const Field = ({ label, value }: { label: string; value: string }) => (
	<>
		<div style={{ color: "var(--color-muted)" }}>{label}</div>
		<div>{value}</div>
	</>
)

export const PreviewPane = ({
	artifact: served,
	projectName,
	siblings,
	folder,
	onStep,
	fullView,
	onFullViewChange,
	onClose,
	listWidth,
}: {
	artifact: VisibleArtifact
	projectName: string | null
	/** The current folder's files in the list's order (`previewNavFor`); ↑ ↓, j / k and Present step through them. */
	siblings: VisibleArtifact[]
	/** The path line's folder crumb: the file's Project, or the list it came from. */
	folder: FolderRef
	/** Show another file in place: a list replaces `?preview=`, the full page replaces `/artifacts/:id`. */
	onStep: (artifactId: string) => void
	/** The list column's width beside the pane; the pane's left edge is its drag handle. */
	listWidth: ListWidth
	/**
	 * Full view covers the viewport (Open, or a double-click on a row); the screen keeps it in the URL
	 * (`?view=full`) so it survives a reload. Back sets it false, returning to the list with the pane open.
	 */
	fullView: boolean
	onFullViewChange: (fullView: boolean) => void
	onClose: () => void
}) => {
	const toast = useToast()
	const pinned = usePinned()
	const connections = useConnections()
	// `?panel=history|comments|ledger` opens the side panel, so a link can land on a revision list.
	const [params, setParams] = useSearchParams()
	const requestedPanel = params.get("panel")
	const [presenting, setPresenting] = useState(false)
	// Full view always has room for Present; the docked pane only on a window 1800px or wider (v5 §6).
	const presentFitsPane = usePresentFitsPane()
	const showPresentButton = fullView || presentFitsPane
	// Full view opened straight from an address (the first location, key "default") is the page itself and
	// shows at once; sliding it in would show the frame behind it first.
	const location = useLocation()
	const slidesIn = !fullView || location.key !== "default"
	// A new Current Revision swaps in only for a reader on the latest one outside Present and History's Compare;
	// anyone else keeps the Revision they are reading, under a bar that moves to the new one.
	const held = useHeldRevision(served, !presenting && requestedPanel !== "history")
	const artifact = held.artifact
	const isHtml = artifact.kind === "html"
	const isImage = artifact.kind === "image"
	const isPdf = artifact.kind === "pdf"
	const isPptx = artifact.kind === "pptx"
	const isBodyPreviewKind = isHtml || isImage || isPdf || isPptx
	const isPreviewTokenKind = artifact.kind === "docx" || artifact.kind === "xlsx"
	const isOwner = artifact.access === "owner"
	// Before anything is approved, the Owner (or the draft's author) reads the Pending Revision it would approve.
	const reading = useReadingRevision(artifact)
	const hasRevision = reading.revisionId !== null
	const body = useBodyToken(artifact.id, reading.revisionId, isBodyPreviewKind && hasRevision, reading.pending)
	const preview = usePreviewToken(artifact.id, artifact.visibleRevisionId, isPreviewTokenKind && hasRevision)
	const [menu, setMenu] = useState<DOMRect | null>(null)
	const [redactionAnchor, setRedactionAnchor] = useState<DOMRect | null>(null)
	const [shareOpen, setShareOpen] = useState(false)
	const [linkOpen, setLinkOpen] = useState(false)
	const setPanel = (next: PanelTab | null) =>
		setParams(
			(previous) => {
				const nextParams = new URLSearchParams(previous)
				if (next === null) nextParams.delete("panel")
				else nextParams.set("panel", next)
				return nextParams
			},
			{ replace: true },
		)
	const [infoOpen, setInfoOpen] = useState(false)
	const [folderAnchor, setFolderAnchor] = useState<DOMRect | null>(null)
	const projects = useProjects()
	const me = useMe()
	const [zoom, setZoom] = useState(DEFAULT_PREVIEW_ZOOM)
	const pane = listWidth
	const redactionEnabled = edition.useRedactionCapability() === "enabled" && edition.ArtifactRedactionSection !== null
	const [viewAsAiRequested, setViewAsAi] = useState(false)
	const viewAsAi = redactionEnabled && viewAsAiRequested
	const [showExtractedText, setShowExtractedText] = useState(false)
	const currentRevisionId = artifact.currentRevisionId ?? null

	// Selecting another row keeps the pane where it is but never carries the popover or View as AI along.
	useEffect(() => {
		setInfoOpen(false)
		setRedactionAnchor(null)
		setViewAsAi(false)
		setShowExtractedText(false)
		setFolderAnchor(null)
	}, [artifact.id, artifact.visibleRevisionId])

	// The tab names the open file; closing the pane gives the title back.
	useEffect(() => {
		const previous = document.title
		document.title = `${artifact.title} · Exagram`
		return () => {
			document.title = previous
		}
	}, [artifact.title])

	// Where the file sits in its folder. A file its siblings don't hold yet (they are still loading) is alone.
	const siblingIndex = siblings.findIndex((candidate) => candidate.id === artifact.id)
	const order = siblingIndex === -1 ? [artifact] : siblings
	const position = Math.max(0, siblingIndex)
	const previousId = order[position - 1]?.id ?? null
	const nextId = order[position + 1]?.id ?? null

	// ↑ / ↓ and k / j step whenever the pane or the page is open, Present included; never while typing, and
	// never while a menu or dialog has the keyboard.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
			const back = event.key === "ArrowUp" || event.key === "k"
			const forward = event.key === "ArrowDown" || event.key === "j"
			if (!back && !forward) return
			if (event.target instanceof Element && event.target.closest(TYPING)) return
			if (document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]')) return
			const target = back ? previousId : nextId
			if (target === null) return
			event.preventDefault()
			onStep(target)
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [previousId, nextId, onStep])

	const isPinned = pinned.isPinned(artifact.id)
	const rev = artifact.revisionSeq === null ? "—" : `v${artifact.revisionSeq}`
	const project = projectName ?? "No project"
	const clients = (connections.data ?? []).filter((connection) => connection.revokedAt === null)

	const togglePin = () => {
		pinned.toggle(artifact.id)
		toast(isPinned ? "Unpinned." : "Pinned — shows in the sidebar for everyone who can see it.")
	}

	// The v3.3 meta line also carries the file's size; the API doesn't list one yet, so it is left out. The
	// Project and the kind are not in it: the path line above names the folder and the tile shows the kind.
	const meta = `${rev} · edited ${editedLabel(artifact.updatedAt)}`
	const sharedPeople = useSharedPeople(artifact, fullView)
	// History and the Ledger are the Owner's; everyone with the pane gets Comments.
	const tabs: PanelTab[] = isOwner ? ["history", "comments", "ledger"] : ["comments"]
	const sideTabs: SideTab[] = isOwner ? ["comments", "ledger"] : ["comments"]
	const panel: PanelTab | null =
		requestedPanel === "history" || requestedPanel === "comments" || requestedPanel === "ledger"
			? tabs.includes(requestedPanel)
				? requestedPanel
				: "comments"
			: null

	const actions = useArtifactActions({
		artifact,
		onFileInfo: () => setInfoOpen(true),
		onHistory: () => setPanel(isOwner ? "history" : "comments"),
		onDeleted: onClose,
	})
	// Present leaves the pane or the page it starts from in place; leaving it returns there. Declared ahead of the
	// menu, whose docked Present item calls it.
	const startPresent = () => {
		setInfoOpen(false)
		setFolderAnchor(null)
		setPresenting(true)
	}

	// Every item closes the menu first; a dialog, a panel or a toast then takes over.
	const menuItems: MenuItem[] = composePreviewMenuItems({
		// On a Mac browser, "Open in Mac app" follows the file's own actions (the link itself navigates).
		items: [...actions.items, ...edition.openInAppItems(paths.artifact(artifact.id), () => undefined)],
		pinItem: actions.pinItem,
		deleteItem: actions.deleteItem,
		docked: fullView
			? null
			: {
					onPresent: showPresentButton ? null : startPresent,
					onCopyLink: actions.copyLink,
					isPinned,
					onTogglePin: togglePin,
				},
		isOwner,
		viewAsAi,
		redactionEnabled,
		onLinks: () => setLinkOpen(true),
		onRedaction: () => setRedactionAnchor(menu),
		onViewAsAi: () => setViewAsAi((current) => !current),
		onComments: () => setPanel("comments"),
		onLedger: () => setPanel("ledger"),
	}).map((item) => ({
		...item,
		onSelect: () => {
			setMenu(null)
			item.onSelect()
		},
	}))

	// Open and Back each unmount themselves, so focus is handed to the control that takes their place:
	// Back on entering full view, Open on leaving it. Only a change moves focus, never the first render.
	// They are found in the header by a data attribute, since `IconButton` takes no ref.
	const headerRef = useRef<HTMLDivElement>(null)
	const wasFullView = useRef(fullView)
	useEffect(() => {
		if (wasFullView.current === fullView) return
		wasFullView.current = fullView
		headerRef.current?.querySelector<HTMLButtonElement>(`[data-focus-target="${fullView ? "back" : "open"}"]`)?.focus()
	}, [fullView])

	// File info closes on Escape and hands focus back to its button; the Escape is claimed so the pane stays.
	const infoButtonRef = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		if (!infoOpen) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			event.preventDefault()
			setInfoOpen(false)
			infoButtonRef.current?.focus()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [infoOpen])

	const openFullView = () => {
		setInfoOpen(false)
		onFullViewChange(true)
	}
	const back = () => {
		setInfoOpen(false)
		onFullViewChange(false)
	}

	// Present covers everything with the document; leaving it returns to the pane or the page it started from,
	// which is whatever `fullView` still says, and hands focus back to Present, or to ⋯ when it started there.
	const wasPresenting = useRef(false)
	useEffect(() => {
		if (wasPresenting.current && !presenting)
			(
				headerRef.current?.querySelector<HTMLButtonElement>('[data-focus-target="present"]') ??
				headerRef.current?.querySelector<HTMLButtonElement>('[data-focus-target="more"]')
			)?.focus()
		wasPresenting.current = presenting
	}, [presenting])

	// History is a clock on the meta line after Details (v3.6 §2), in the pane and full view alike; only the
	// Owner has one.
	// It opens the Revision history modal.
	const historyButton = tabs.includes("history") ? (
		<InlineIconButton
			size={22}
			title="Revision history"
			aria-label="History"
			aria-haspopup="dialog"
			active={panel === "history"}
			onClick={() => setPanel("history")}
			style={{ marginLeft: -6 }}
		>
			<IconHistory size={14} />
		</InlineIconButton>
	) : null

	const details = (
		<div
			className="relative flex min-w-0 items-center whitespace-nowrap"
			style={{ gap: 8, fontSize: 12, color: "var(--color-muted)", marginTop: 3 }}
		>
			<span className="min-w-0 truncate">{meta}</span>
			{isIndexing(artifact) ? (
				<span className="flex flex-none items-center" style={{ gap: 6 }}>
					<ThinkingMatrix size={12} />
					<span aria-hidden>Indexing</span>
				</span>
			) : null}
			<InlineIconButton
				ref={infoButtonRef}
				size={22}
				title="Details"
				aria-label="Details"
				aria-expanded={infoOpen}
				active={infoOpen}
				onClick={() => setInfoOpen((value) => !value)}
				style={{ marginLeft: -2 }}
			>
				<IconInfo size={14} strokeWidth={1.8} />
			</InlineIconButton>
			{historyButton}
			{infoOpen ? (
				<div
					role="dialog"
					aria-label="Details"
					className="absolute grid whitespace-normal"
					style={{
						left: 0,
						top: 24,
						zIndex: 10,
						width: 320,
						background: "var(--color-panel)",
						border: "1px solid var(--color-line-faint)",
						borderRadius: "var(--radius)",
						boxShadow: POPOVER_SHADOW,
						padding: "16px 18px",
						gridTemplateColumns: "auto 1fr",
						gap: "10px 16px",
						fontSize: 14,
						color: "var(--color-ink)",
						animation: "fadeUp var(--duration-panel) var(--ease-arrive)",
					}}
				>
					{artifact.sourceFilename ? <Field label="Original filename" value={artifact.sourceFilename} /> : null}
					{artifact.sourceDescription ? <Field label="Description" value={artifact.sourceDescription} /> : null}
					<Field label="Project" value={project} />
					<Field label="Owner" value={artifact.ownerName} />
					<Field
						label="Shared with"
						value={artifact.sharedWithNames.length > 0 ? `${artifact.sharedWithNames.length + 1} people` : "Only you"}
					/>
					<Field
						label="Clients"
						value={clients.length > 0 ? clients.map((connection) => connection.name).join(", ") : "None"}
					/>
					<Field label="Revision" value={`${rev} · current`} />
				</div>
			) : null}
		</div>
	)

	// The path line's folder crumb (v3.3 §2): the folder's name, muted, before the title. It keeps its width
	// (the title truncates first) up to a cap, and opens the path dropdown.
	const folderButton = (
		<button
			type="button"
			aria-label={`Browse ${folder.name}`}
			aria-haspopup="menu"
			aria-expanded={folderAnchor !== null}
			title="Folder path"
			onClick={(event) => setFolderAnchor(folderAnchor ? null : event.currentTarget.getBoundingClientRect())}
			className={clsx(
				"press truncate whitespace-nowrap hover:bg-subtle hover:text-ink",
				folderAnchor ? "bg-subtle text-ink" : "text-muted",
			)}
			style={{
				flex: "0 0 auto",
				minWidth: 28,
				maxWidth: 320,
				height: 26,
				padding: "0 6px",
				marginLeft: -6,
				borderRadius: "var(--radius)",
				fontSize: 14,
			}}
		>
			{folder.name}
		</button>
	)

	// Pin and copy link sit right after the title (v3.6 §2), in the pane as well as full view.
	const pinButton = (
		<InlineIconButton
			size={26}
			title="Pin"
			aria-label={isPinned ? "Unpin" : "Pin"}
			aria-pressed={isPinned}
			onClick={togglePin}
			active={isPinned}
			style={{ marginLeft: 4 }}
		>
			<IconPin size={15} fill={isPinned ? "currentColor" : "none"} />
		</InlineIconButton>
	)

	const copyLinkButton = (
		<InlineIconButton size={26} title="Copy link" aria-label="Copy link" onClick={actions.copyLink}>
			<IconLink size={15} />
		</InlineIconButton>
	)

	const moreButton = (
		<HeaderIconButton
			title="More"
			data-focus-target="more"
			aria-label={`More actions for ${artifact.title}`}
			aria-expanded={menu !== null}
			onClick={(event) => setMenu(event.currentTarget.getBoundingClientRect())}
		>
			<IconEllipsis size={18} />
		</HeaderIconButton>
	)

	// The document canvas: the same body in the pane, on the page and in Present.
	const canvas = (
		<div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ground">
			{isOwner && viewAsAi ? (
				// The toggle lives in the ⋯ menu; while the AI view is on, this chip is the way back out.
				<div
					className="absolute flex items-center gap-2 border border-line-faint bg-white"
					style={{ top: 12, right: 16, padding: "4px 6px 4px 12px", fontSize: 12, zIndex: 5 }}
				>
					Viewing as AI
					<button
						type="button"
						onClick={() => setViewAsAi(false)}
						className="hover:bg-menu-hover"
						style={{ padding: "2px 8px", fontWeight: 600 }}
					>
						Exit
					</button>
				</div>
			) : null}
			{isOwner && viewAsAi ? (
				<div className="min-h-0 flex-1 overflow-auto">
					{currentRevisionId === null ? (
						<p className="text-muted p-8 pt-14 text-sm">No approved version yet. AI tools can&apos;t read this file.</p>
					) : (
						edition.ViewAsAiSection && <edition.ViewAsAiSection revisionId={currentRevisionId} />
					)}
				</div>
			) : !hasRevision ? (
				<div className="flex-1" style={{ padding: 20, fontSize: 15, color: "var(--color-muted)" }}>
					No approved Revision to read yet.
				</div>
			) : isBodyPreviewKind && !showExtractedText ? (
				<div
					className="relative min-h-0 flex-1 overflow-hidden bg-white"
					style={{ pointerEvents: pane.dragging ? "none" : undefined }}
				>
					{body.isPending ? (
						<SkeletonText lines={6} style={{ padding: 20 }} />
					) : body.isError ? (
						<div role="alert" style={{ padding: 20, fontSize: 14, color: "var(--color-muted)" }}>
							{body.error.message}
						</div>
					) : body.data.revisionId !== reading.revisionId ? (
						<div role="alert" style={{ padding: 20, fontSize: 14, color: "var(--color-muted)" }}>
							This version changed. Refresh to read it.
						</div>
					) : isHtml ? (
						<HtmlFrame key={body.data.url} url={body.data.url} title={artifact.title} zoom={zoom} />
					) : isImage ? (
						<ImageFrame key={body.data.url} url={body.data.url} title={artifact.title} zoom={zoom} />
					) : isPdf ? (
						<PdfFrame key={body.data.url} url={body.data.url} title={artifact.title} zoom={zoom} />
					) : (
						<OfficeFrame key={body.data.url} url={body.data.url} title={artifact.title} zoom={zoom} />
					)}
					{isPdf || isPptx ? (
						<button
							type="button"
							onClick={() => setShowExtractedText(true)}
							className="absolute right-4 bottom-4 z-20 border border-line-strong bg-white px-3 py-2 text-[13px]"
						>
							Preview unavailable? Show extracted text
						</button>
					) : null}
				</div>
			) : isPreviewTokenKind &&
			  preview.data?.url &&
			  preview.data.revisionId === artifact.visibleRevisionId &&
			  !showExtractedText ? (
				<div className="relative min-h-0 flex-1 overflow-hidden bg-white">
					<ScaledFrame url={preview.data.url} title={artifact.title} zoom={zoom} sandbox="" />
					<button
						type="button"
						onClick={() => setShowExtractedText(true)}
						className="absolute right-4 bottom-4 border border-line-strong bg-white px-3 py-2 text-[13px]"
					>
						Preview unavailable? Show extracted text
					</button>
				</div>
			) : (
				<ReadingBody artifact={artifact} zoom={zoom} reading={reading} />
			)}
		</div>
	)

	const menus = (
		<>
			{menu ? <Menu anchor={menu} ariaLabel={artifact.title} onClose={() => setMenu(null)} items={menuItems} /> : null}
			{redactionEnabled && redactionAnchor ? (
				<RedactionPopover artifactId={artifact.id} anchor={redactionAnchor} onClose={() => setRedactionAnchor(null)} />
			) : null}
			{folderAnchor ? (
				<PathMenu
					anchor={folderAnchor}
					crumbs={crumbsFor({ folder, projects: projects.data ?? [], meId: me.data?.id ?? null })}
					onClose={() => setFolderAnchor(null)}
				/>
			) : null}
			{actions.dialogs}
			{shareOpen ? <ShareDialog artifact={artifact} onClose={() => setShareOpen(false)} /> : null}
			{panel === "history" ? (
				// History lists what the server serves now, the new Current Revision included.
				<HistoryDialog artifact={served} onDownloadCurrent={actions.download} onClose={() => setPanel(null)} />
			) : null}
			{linkOpen ? <LinkDialog artifactId={artifact.id} onClose={() => setLinkOpen(false)} /> : null}
		</>
	)

	return (
		<div
			aria-label={`Preview of ${artifact.title}`}
			className="flex flex-col"
			style={{
				// The list is sized and the pane fills the rest at any width; it slides in from the right.
				...paneFrame(fullView, panel),
				background: "var(--color-panel)",
				// No fill mode: a finished transform animation that stays applied would trap the pane's fixed dialogs inside it.
				animation: slidesIn ? "slideIn var(--duration-panel) var(--ease-arrive)" : undefined,
				userSelect: pane.dragging ? "none" : undefined,
			}}
		>
			{presenting ? (
				// Present hides every other control; the pane keeps its place behind it, so leaving returns here.
				<PresentMode
					title={artifact.title}
					folderName={folder.name}
					typeLabel={KIND_TAG[artifact.kind]}
					onExit={() => setPresenting(false)}
				>
					{canvas}
				</PresentMode>
			) : (
				<>
					{fullView ? null : (
						// The drag handle straddles the left edge (T:L3022). It sizes the list, so its value is the
						// list's width; the arrow keys move the edge the way they point.
						<div
							role="separator"
							aria-label="Resize list"
							aria-orientation="vertical"
							aria-valuenow={pane.width}
							aria-valuemin={LIST_MIN_WIDTH}
							aria-valuemax={pane.max}
							tabIndex={0}
							onPointerDown={pane.startDrag}
							onKeyDown={(event) => {
								if (event.key === "ArrowLeft") pane.nudge(-24)
								else if (event.key === "ArrowRight") pane.nudge(24)
								else return
								event.preventDefault()
							}}
							className={clsx(
								"absolute top-0 bottom-0 hover:bg-hover focus-visible:bg-press focus-visible:outline-none",
								pane.dragging && "bg-press",
							)}
							style={{ left: -4, width: 8, cursor: "col-resize", touchAction: "none", zIndex: 6 }}
						/>
					)}

					{/* v3.6 header: one bar. Close (Back in full view) and, in full view, the kind tile; then the path line
					    (folder / title, then pin and copy link) over the meta line with the Details and History icons;
					    then zoom (full view) and ⋯, and on one row a rule and the shared-with avatars (full view only),
					    Present (full view, or the pane from 1800px), Open (pane only) and Share. The side preview's path line drops the folder crumb.
					    ↑ ↓ / j k step on the keyboard only. */}
					<div
						ref={headerRef}
						className="flex min-w-0 flex-none items-center bg-panel"
						style={{
							gap: 10,
							padding: fullView ? "12px 16px 12px 14px" : "10px 12px",
							borderBottom: "1px solid var(--color-pane-line)",
						}}
					>
						{/* In the Mac app an Artifact's page is a tab of its own, so there is nothing to go back to. */}
						{fullView && macTabs() ? null : (
							<div className="flex flex-none items-center" style={{ marginLeft: -4 }}>
								{fullView ? (
									<HeaderIconButton title="Back" aria-label="Back" data-focus-target="back" onClick={back}>
										<IconArrowLeft size={16} />
									</HeaderIconButton>
								) : (
									<HeaderIconButton title="Close" aria-label="Close preview" onClick={onClose}>
										<IconClose size={16} />
									</HeaderIconButton>
								)}
							</div>
						)}
						{fullView ? <TypeTile kind={artifact.kind} size={34} /> : null}

						<div className="min-w-0" style={{ flex: "1 1 auto", minWidth: 120 }}>
							<div className="flex min-w-0 items-center">
								{fullView ? (
									<>
										{folderButton}
										<span
											aria-hidden
											className="flex-none text-path-slash"
											style={{ fontSize: 15, padding: "0 6px 0 4px" }}
										>
											/
										</span>
									</>
								) : null}
								<span
									className="min-w-0 truncate text-ink"
									style={{
										flex: "0 1 auto",
										minWidth: 48,
										fontSize: 16,
										fontWeight: 600,
										lineHeight: 1.3,
										letterSpacing: "-.01em",
									}}
									title={artifact.title}
								>
									{artifact.title}
								</span>
								{pinButton}
								{copyLinkButton}
							</div>
							{details}
						</div>

						<div className="flex flex-none items-center" style={{ gap: 2, marginRight: -4 }}>
							{fullView ? <ZoomMenu value={zoom} onChange={setZoom} /> : null}
							{moreButton}
						</div>
						{fullView ? <RowDivider /> : null}
						<div className="flex flex-none items-center" style={{ gap: 6 }}>
							{fullView ? <SharedAvatars people={sharedPeople} onClick={() => setShareOpen(true)} /> : null}
							{/* In the docked pane Present is the bare icon, and below 1800px it moves into ⋯. */}
							{showPresentButton ? (
								<Button
									variant="outline"
									size={32}
									title="Present full screen"
									aria-label="Present"
									data-focus-target="present"
									onClick={startPresent}
									style={{ padding: "0 10px" }}
								>
									<IconMaximize size={14} />
									{fullView ? "Present" : null}
								</Button>
							) : null}
							<UseInClaude artifactId={artifact.id} />
							{fullView ? null : (
								<Button variant="outline" size={32} data-focus-target="open" onClick={openFullView}>
									Open
								</Button>
							)}
							<Button size={32} onClick={() => setShareOpen(true)} style={{ padding: "0 14px" }}>
								Share
							</Button>
						</div>
					</div>

					<PendingBanner artifactId={artifact.id} />
					{held.newer ? <NewRevisionBar onView={held.view} /> : null}

					<div className="flex min-h-0 flex-1">
						{canvas}
						{panel === null || panel === "history" ? null : (
							<SidePanel
								artifact={artifact}
								tab={panel}
								tabs={sideTabs}
								onTab={setPanel}
								onClose={() => setPanel(null)}
							/>
						)}
					</div>
				</>
			)}

			{menus}
		</div>
	)
}
