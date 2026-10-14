import { useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { SheetRow, SheetRows, SheetSeparator } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import {
	IconClock,
	IconDownload,
	IconFile,
	IconInfo,
	IconLink,
	IconPin,
	IconShare,
	IconTrash,
} from "@/components/ui/icons"
import { IconMove } from "@/components/ui/icons"
import { edition } from "@/edition/edition"
import { useProjectName, useSheetArtifact } from "@/features/artifact/sheets/sheetData"
import { ConfirmPanel, SheetGone, SheetLoading } from "@/features/artifact/sheets/sheetParts"
import { useArtifactActions } from "@/features/artifact/useArtifactActions"
import { paths } from "@/routes/paths"

/**
 * File actions (core `kind === "file"`): the file's name over "Project · vN", then Open, Share,
 * Copy link, Pin; Move, Version history, Details; Download and Delete. Each row appears only where the API
 * would honour it, by the same gates as desktop's ⋯ menu (`useArtifactActions`): Move, Version history and
 * Delete are the Owner's. Pin, Download, Copy link and Delete run desktop's own actions, toasts included.
 */
const FileSheet = ({ params }: { params: SheetParams["file"] }) => {
	const { artifact, loading } = useSheetArtifact(params.artifactId)
	const projectName = useProjectName(artifact?.projectId ?? null)
	const sheet = useSheet()
	const navigate = useNavigate()
	const location = useLocation()
	const [confirming, setConfirming] = useState(false)
	const artifactPath = paths.artifact(params.artifactId)

	const actions = useArtifactActions({
		artifact,
		onFileInfo: () => sheet.push("details", { artifactId: params.artifactId }),
		onHistory: () => sheet.push("history", { artifactId: params.artifactId }),
		// Deleting the file being read leaves the reading view for the library; anywhere else the list refreshes.
		onDeleted: () => {
			if (location.pathname === artifactPath) sheet.closeThen(() => void navigate(paths.library, { replace: true }))
			else sheet.close()
		},
	})

	if (loading) return <SheetLoading title="File" />
	if (!artifact || !actions.run) return <SheetGone />
	const run = actions.run

	const isOwner = artifact.access === "owner"
	const rev = artifact.revisionSeq === null ? "—" : `v${artifact.revisionSeq}`
	const where = projectName ?? "No folder"
	const target = { kind: "artifact", id: artifact.id } as const

	if (confirming) {
		return (
			<Sheet title="Delete this file" sub={artifact.title}>
				<ConfirmPanel
					message={edition.copy.deleteArtifact.confirm}
					confirmLabel="Delete"
					busy={run.deleting}
					onCancel={() => setConfirming(false)}
					onConfirm={run.deleteFile}
				/>
			</Sheet>
		)
	}

	return (
		<Sheet title={artifact.title} sub={`${where} · ${rev}`}>
			<SheetRows>
				<SheetRow
					icon={<IconFile size={18} />}
					label="Open"
					onClick={() => {
						// Opening the file already on screen has nowhere to go; the drawer just gets out of the way.
						if (location.pathname === artifactPath) sheet.close()
						else void navigate(artifactPath)
					}}
				/>
				<SheetRow
					icon={<IconShare size={18} />}
					label="Share"
					chevron
					onClick={() => sheet.push("share", { target })}
				/>
				<SheetRow
					icon={<IconLink size={18} />}
					label="Copy link"
					onClick={() => {
						actions.copyLink()
						sheet.close()
					}}
				/>
				{edition.pins ? (
					<SheetRow
						icon={<IconPin size={18} fill={run.isPinned ? "currentColor" : "none"} />}
						label={run.isPinned ? "Unpin" : "Pin"}
						onClick={() => {
							run.togglePin()
							sheet.close()
						}}
					/>
				) : null}
				<SheetSeparator />
				{isOwner ? (
					<SheetRow
						icon={<IconMove size={18} />}
						label="Move to…"
						value={where}
						chevron
						onClick={() => sheet.push("move", { artifactId: artifact.id })}
					/>
				) : null}
				{isOwner ? (
					<SheetRow
						icon={<IconClock size={18} />}
						label="Version history"
						value={rev}
						chevron
						onClick={() => sheet.push("history", { artifactId: artifact.id })}
					/>
				) : null}
				<SheetRow
					icon={<IconInfo size={18} />}
					label="Details"
					chevron
					onClick={() => sheet.push("details", { artifactId: artifact.id })}
				/>
				{artifact.canDownload || isOwner ? <SheetSeparator /> : null}
				{artifact.canDownload ? (
					<SheetRow
						icon={<IconDownload size={18} />}
						label="Download"
						onClick={() => {
							// The download tab opens inside this tap, before the drawer goes; a failure still toasts.
							run.download()
							sheet.close()
						}}
					/>
				) : null}
				{isOwner ? (
					<SheetRow icon={<IconTrash size={18} />} label="Delete" danger onClick={() => setConfirming(true)} />
				) : null}
			</SheetRows>
		</Sheet>
	)
}

export default FileSheet
