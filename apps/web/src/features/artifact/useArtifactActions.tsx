import { type VisibleArtifact } from "@exagram/api-client"
import { type ReactNode, useState } from "react"

import { useToast } from "@/components/Toast"
import {
	IconClock,
	IconCopy,
	IconDownload,
	IconFolder,
	IconInfo,
	IconPin,
	IconTag,
	IconTrash,
	IconUpload,
} from "@/components/ui/icons"
import { type MenuItem } from "@/components/ui/Menu"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { DeleteArtifactDialog } from "@/features/artifact/DeleteArtifactDialog"
import { ageLabel } from "@/features/artifact/reading/format"
import { TagsDialog } from "@/features/artifact/reading/TagsDialog"
import { usePinned } from "@/features/library/hooks/usePinned"
import { downloadName, saveBlob, TEXT_BACKED_KINDS } from "@/features/library/paneActions"
import { UploadDialog } from "@/features/library/UploadDialog"
import { useDeleteArtifact } from "@/features/project/hooks/useProjectMutations"
import { MoveArtifactDialog } from "@/features/project/MoveArtifactDialog"
import { paths } from "@/routes/paths"
import { useInvalidate } from "@/utils/react-query"

type ActionDialog = "tags" | "upload" | "move" | "delete" | null

export type ArtifactActionRun = {
	isPinned: boolean
	togglePin: () => void
	download: () => void
	deleting: boolean
	/** Deletes at once; the caller asks first, as the desktop confirmation does. */
	deleteFile: () => void
}

/**
 * Copies the Artifact's one address and says who it opens for. The list row's link button, the preview
 * header's copy link and the docked pane's ⋯ Copy link all call this, so they copy the same URL with the same toast.
 */
export const copyArtifactLink = (artifactId: string, toast: (message: string) => void): Promise<void> =>
	navigator.clipboard
		.writeText(`${window.location.origin}${paths.artifact(artifactId)}`)
		.then(() => toast("Link copied — opens only for people this file is shared with."))
		.catch(() => toast("Could not copy the link"))

/**
 * The one ⋯ menu an Artifact has, whether it is previewed in the library or open in the reading
 * view: Tags, Pin for org, File info, Revision history, Duplicate, Download, Upload
 * a new version, Move project — `items`, in that order — plus Delete, returned separately as
 * `deleteItem` so the caller can place it last, behind its own divider. The caller says where
 * File info and Revision history live on its screen and what happens once the file is gone;
 * everything else is the same in both. Each item is shown only where the API would honour it for
 * `artifact.access`: Edit with AI and Upload a new version need owner or edit (Edit with AI also needs
 * the install to have AI edit on); Revision history,
 * Move project and Delete need owner; Duplicate needs owner, or no Project since a duplicate not
 * moving Projects skips the API's owner-only `requireOwnedProject` check.
 */
export const useArtifactActions = ({
	artifact,
	onFileInfo,
	onHistory,
	onDeleted,
}: {
	artifact: VisibleArtifact | null
	onFileInfo: () => void
	onHistory: () => void
	onDeleted: () => void
}): {
	items: MenuItem[]
	/** "Pin for org", the very item in `items`, so a menu with its own pin toggle can leave it out. */
	pinItem: MenuItem | null
	deleteItem: MenuItem | null
	copyLink: () => void
	/** The ⋯ menu's Download: the file the reader sees now. */
	download: () => void
	dialogs: ReactNode
	/** The same actions without the menu or desktop dialogs, for a screen that draws its own (the mobile File drawer). */
	run: ArtifactActionRun | null
} => {
	const toast = useToast()
	const invalidate = useInvalidate()
	const pinned = usePinned()
	const remove = useDeleteArtifact()
	const [dialog, setDialog] = useState<ActionDialog>(null)
	const [busy, setBusy] = useState<"duplicate" | "download" | null>(null)
	const ee = edition.useArtifactEeActions(artifact)

	if (artifact === null)
		return {
			items: [],
			pinItem: null,
			deleteItem: null,
			copyLink: () => undefined,
			download: () => undefined,
			dialogs: null,
			run: null,
		}

	const isPinned = pinned.isPinned(artifact.id)
	const rev = artifact.revisionSeq === null ? "—" : `v${artifact.revisionSeq}`
	// An html body is served only from the usercontent origin (ADR-0015) — `revisions.text` refuses
	// it, so Download takes the token+tab path like binary kinds.
	const downloadsAsText = TEXT_BACKED_KINDS.has(artifact.kind) && artifact.kind !== "html"
	// Mirrors the API's own gates: RevisionsUsecase.requireWritable refuses a Viewer only,
	// so Collaborators and up may propose a new Revision; revisions.list's getOwned and
	// artifacts.move/softDelete/create's writes stay owner-scoped.
	const canWrite = artifact.access !== "view"
	const isOwner = artifact.access === "owner"
	// A copy is the reader's own, and theirs to download, so it goes with Download when the Owner turned that off.
	const canDuplicate = (isOwner || artifact.projectId === null) && artifact.canDownload

	const togglePin = () => {
		pinned.toggle(artifact.id)
		toast(isPinned ? "Unpinned." : "Pinned — shows in the sidebar for everyone who can see it.")
	}

	/** doc / html / chat come back byte-for-byte from `revisions.text`; the binary kinds only have extracted text. */
	const fetchTextFile = async (): Promise<File> => {
		const body = await apiClient.revisions.text({ artifactId: artifact.id })
		return new File([body.text], downloadName(artifact.sourceFilename || artifact.title, body.mime), {
			type: body.mime,
		})
	}

	const download = async () => {
		setBusy("download")
		try {
			if (downloadsAsText) {
				const file = await fetchTextFile()
				saveBlob(file, file.name)
			} else {
				// Opened before the await, while user activation is still fresh — a popup blocker can
				// reject `window.open` once an awaited token comes back. `tab.opener = null` stands in
				// for "noopener", which browsers ignore on an already-open blank tab.
				const tab = window.open("", "_blank")
				if (tab === null) {
					toast("Your browser blocked the download tab. Allow pop-ups for this site and try again.")
					return
				}
				tab.opener = null
				try {
					const token = await apiClient.revisions.bodyToken({ artifactId: artifact.id })
					const url = new URL(token.url)
					if (artifact.kind === "html") url.searchParams.set("download", "1")
					tab.location.href = url.toString()
				} catch (error) {
					tab.close()
					throw error
				}
			}
		} catch (error) {
			toast(error instanceof Error ? error.message : "Could not download this file")
		} finally {
			setBusy(null)
		}
	}

	const duplicate = async () => {
		setBusy("duplicate")
		try {
			const { artifact: copy, revision } = await apiClient.artifacts.duplicate({ artifactId: artifact.id })
			invalidate([
				QueryKeys.approvals.pending(),
				QueryKeys.artifacts.get(copy.id),
				QueryKeys.revisions.list(copy.id),
				["artifacts", "list"],
			])
			toast(
				revision.status === "pending"
					? `Duplicated — "${copy.title}" is waiting under Pending.`
					: `Duplicated — "${copy.title}" is live.`,
			)
		} catch (error) {
			toast(error instanceof Error ? error.message : "Could not duplicate this file")
		} finally {
			setBusy(null)
		}
	}

	const deleteFile = () =>
		remove.mutate(
			{ artifactId: artifact.id },
			{
				onSuccess: () => {
					toast("Deleted. Bytes are kept — recovery currently needs engineering access.")
					onDeleted()
				},
				onError: (error) => toast(error.message),
			},
		)

	const pinItem: MenuItem = {
		label: isPinned ? "Unpin for org" : "Pin for org",
		icon: <IconPin size={16} fill={isPinned ? "currentColor" : "none"} />,
		onSelect: togglePin,
	}

	const items: MenuItem[] = [
		{ label: "Tags…", icon: <IconTag size={16} />, onSelect: () => setDialog("tags") },
		...ee.items,
		pinItem,
		{ label: "File info", icon: <IconInfo size={16} />, onSelect: onFileInfo },
		...(isOwner
			? [
					{
						label: `Revision history · ${rev} · ${ageLabel(artifact.updatedAt).toUpperCase()}`,
						icon: <IconClock size={16} />,
						onSelect: onHistory,
					},
				]
			: []),
		...(canDuplicate
			? [
					{
						label: busy === "duplicate" ? "Duplicating…" : "Duplicate",
						icon: <IconCopy size={16} />,
						onSelect: () => void duplicate(),
					},
				]
			: []),
		// Anyone with the link can be told not to download (ADR 0044); the button goes, not only its action.
		...(artifact.canDownload
			? [
					{
						label: busy === "download" ? "Downloading…" : "Download",
						icon: <IconDownload size={16} />,
						onSelect: () => void download(),
					},
				]
			: []),
		...(canWrite
			? [{ label: "Upload a new version", icon: <IconUpload size={16} />, onSelect: () => setDialog("upload") }]
			: []),
		...(isOwner ? [{ label: "Move project", icon: <IconFolder size={16} />, onSelect: () => setDialog("move") }] : []),
	]

	const deleteItem: MenuItem | null = isOwner
		? {
				label: "Delete this file",
				icon: <IconTrash size={16} />,
				color: "var(--color-danger)",
				dividerAbove: true,
				onSelect: () => setDialog("delete"),
			}
		: null

	const dialogs = (
		<>
			{dialog === "tags" ? (
				<TagsDialog artifactId={artifact.id} title={artifact.title} onClose={() => setDialog(null)} />
			) : null}
			{ee.dialogs}
			{dialog === "upload" ? (
				<UploadDialog
					projectId={artifact.projectId}
					artifactId={artifact.id}
					access={artifact.access}
					publishPolicy={artifact.effectivePublishPolicy}
					onClose={() => setDialog(null)}
				/>
			) : null}
			{dialog === "move" ? (
				<MoveArtifactDialog
					artifactId={artifact.id}
					title={artifact.title}
					currentProjectId={artifact.projectId}
					onClose={() => setDialog(null)}
				/>
			) : null}
			{dialog === "delete" ? (
				<DeleteArtifactDialog
					title={artifact.title}
					onConfirm={() => {
						setDialog(null)
						deleteFile()
					}}
					onClose={() => setDialog(null)}
				/>
			) : null}
		</>
	)

	const copyLink = () => void copyArtifactLink(artifact.id, toast)

	const run: ArtifactActionRun = {
		isPinned,
		togglePin,
		download: () => void download(),
		deleting: remove.isPending,
		deleteFile,
	}

	return { items, pinItem, deleteItem, copyLink, download: () => void download(), dialogs, run }
}
