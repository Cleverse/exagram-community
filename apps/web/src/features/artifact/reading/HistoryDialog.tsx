import { type Revision, type VisibleArtifact } from "@exagram/api-client"
import clsx from "clsx"
import { useState } from "react"

import { Dialog } from "@/components/Dialog"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { IconButton } from "@/components/ui/IconButton"
import { IconClose, IconDownload, IconRestore } from "@/components/ui/icons"
import { SkeletonText } from "@/components/ui/Skeleton"
import { apiClient } from "@/config/apiClient"
import { edition } from "@/edition/edition"
import { restoredMessage, useRestoreAsNew, useRevisions } from "@/features/artifact/hooks/useRevisions"
import { CompareDialog } from "@/features/artifact/reading/CompareDialog"
import { formatSheetDate } from "@/features/artifact/reading/format"
import { authorOf } from "@/features/artifact/reading/revision"
import { Notice, RevisionPreview } from "@/features/artifact/reading/RevisionPreview"
import { activityWhen } from "@/features/library/lastActivity"
import { downloadName, saveBlob } from "@/features/library/paneActions"

/** Where a Revision came from, for imports and AI edits that record it. */
const Provenance = ({ revision }: { revision: Revision }) => {
	const provenance = revision.sourceProvenance
	if (!provenance) return null
	const rows: [string, string][] = [
		["Source", provenance.origin ?? "Unknown"],
		...(provenance.parentRevisionId ? [["Parent revision", provenance.parentRevisionId] as [string, string]] : []),
		...(provenance.restoredFrom ? [["Restored from", provenance.restoredFrom] as [string, string]] : []),
		...(provenance.clientId ? [["Client ID", provenance.clientId] as [string, string]] : []),
		...(provenance.storagePath ? [["Original storage path", provenance.storagePath] as [string, string]] : []),
		...(provenance.snippet ? [["Original snippet", provenance.snippet] as [string, string]] : []),
		...(provenance.aiEdit
			? ([
					["AI model", provenance.aiEdit.model ?? "Unknown"],
					["AI instruction", provenance.aiEdit.instruction ?? "None"],
					["Scoped edit", provenance.aiEdit.scoped === null ? "Unknown" : provenance.aiEdit.scoped ? "Yes" : "No"],
					...(provenance.aiEdit.createdAt
						? [["AI edit time", formatSheetDate(provenance.aiEdit.createdAt)] as [string, string]]
						: []),
				] as [string, string][])
			: []),
	]
	return (
		<details className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
			<summary className="cursor-pointer">{edition.copy.provenanceSummary}</summary>
			<dl className="grid" style={{ gridTemplateColumns: "auto 1fr", gap: "4px 10px", marginTop: 6 }}>
				{rows.map(([label, value]) => (
					<div key={label} className="contents">
						<dt>{label}</dt>
						<dd className="break-all whitespace-pre-wrap">{value}</dd>
					</div>
				))}
			</dl>
		</details>
	)
}

/** Current on pale green, Pending on pale amber, Discarded on the neutral chip (v3.6 §3). */
const Tag = ({ tone, children }: { tone: "current" | "pending" | "discarded"; children: string }) => (
	<span
		className={clsx(
			tone === "current" && "bg-current-tag-bg text-ok-deep",
			tone === "pending" && "bg-pending-tag-bg text-pending-fg",
			tone === "discarded" && "bg-chip text-muted",
		)}
		style={{ fontSize: 11, fontWeight: 500, padding: "2px 6px", borderRadius: 4 }}
	>
		{children}
	</span>
)

/**
 * Revision history (v3.6 §3): a centred modal, revisions on the left and the selected one previewed on the
 * right, with Download and Restore for it in the header. The current revision is selected on open; a click
 * selects a card and never toggles it off. Restoring writes a new Revision, so nothing is ever overwritten.
 */
export const HistoryDialog = ({
	artifact,
	onDownloadCurrent,
	onClose,
}: {
	artifact: VisibleArtifact
	/** The pane's own Download, for the Revision the reader sees now when its kind has no per-Revision text. */
	onDownloadCurrent: () => void
	onClose: () => void
}) => {
	const revisions = useRevisions(artifact.id, artifact.access === "owner")
	const restore = useRestoreAsNew(artifact.id)
	const toast = useToast()
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [comparing, setComparing] = useState<Revision | null>(null)

	const items = [...(revisions.data ?? [])].sort((a, b) => b.seq - a.seq)
	const current = items.find((revision) => revision.id === artifact.currentRevisionId) ?? null
	const selected = items.find((revision) => revision.id === selectedId) ?? current ?? items[0] ?? null
	const fileName = artifact.sourceFilename || artifact.title

	const isCurrent = selected !== null && selected.id === artifact.currentRevisionId
	// Only an approved Revision that is no longer current is worth restoring; a pending or discarded one
	// never reached clients, and the current one is already what they read.
	const canRestore = selected !== null && selected.status === "approved" && !isCurrent
	// The text endpoint serves no HTML body and no image; the office kinds may still lack extracted text,
	// and the Compare dialog then shows the server's own reason.
	const canCompare =
		selected !== null && !isCurrent && current !== null && artifact.kind !== "html" && artifact.kind !== "image"
	// doc and chat come back byte for byte per Revision; every other kind only as the file the reader sees now.
	const perRevisionFile = artifact.kind === "doc" || artifact.kind === "chat"
	const canDownload = selected !== null && (perRevisionFile || selected.id === artifact.visibleRevisionId)

	const stateLabel =
		selected === null
			? ""
			: isCurrent
				? "Current version"
				: selected.status === "pending"
					? "Pending approval"
					: selected.status === "discarded"
						? "Discarded, never published"
						: "Viewing an older version"

	const download = async () => {
		if (selected === null) return
		if (!perRevisionFile) {
			onDownloadCurrent()
			return
		}
		try {
			const body = await apiClient.revisions.revisionText({ artifactId: artifact.id, revisionId: selected.id })
			saveBlob(new Blob([body.text], { type: body.mime }), downloadName(fileName, body.mime))
		} catch (error) {
			toast(error instanceof Error ? error.message : "Could not download this version")
		}
	}

	const restoreSelected = () => {
		if (selected === null) return
		restore.mutate(
			{ revisionId: selected.id },
			{
				onSuccess: (created) => {
					setSelectedId(null)
					toast(restoredMessage(selected.seq, created))
				},
				onError: (error) => toast(error.message),
			},
		)
	}

	const header = (
		<div
			className="flex flex-none items-center border-b border-pane-line"
			style={{ gap: 10, padding: "16px 16px 16px 24px" }}
		>
			<div className="min-w-0 flex-1">
				<h2 className="font-display" style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em" }}>
					Revision history
				</h2>
				<div className="truncate text-muted" style={{ fontSize: 13, marginTop: 2 }}>
					{fileName}
				</div>
			</div>
			{canCompare ? (
				<Button variant="outline" size={32} onClick={() => setComparing(selected)}>
					Compare with current
				</Button>
			) : null}
			{selected && artifact.canDownload ? (
				<Button
					variant="outline"
					size={32}
					gap={6}
					disabled={!canDownload}
					title={canDownload ? undefined : "Only the version clients read now can be downloaded for this file type"}
					onClick={() => void download()}
				>
					<IconDownload size={14} />
					{`Download v${selected.seq}`}
				</Button>
			) : null}
			{canRestore && selected ? (
				<Button size={32} gap={6} disabled={restore.isPending} onClick={restoreSelected}>
					<IconRestore size={14} />
					{`Restore v${selected.seq}`}
				</Button>
			) : null}
			<IconButton size={32} aria-label="Close" title="Close" onClick={onClose} style={{ marginLeft: 4 }}>
				<IconClose size={16} />
			</IconButton>
		</div>
	)

	return (
		<>
			<Dialog
				ariaLabel="Revision history"
				onClose={onClose}
				width={1180}
				scrim={0.4}
				surface="var(--color-panel)"
				header={header}
				bare
				cardStyle={{
					height: "min(820px, calc(100vh - 48px))",
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					borderRadius: 12,
				}}
			>
				<div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "320px minmax(0, 1fr)" }}>
					<div className="flex min-h-0 flex-col border-r border-pane-line bg-history-list">
						<div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 12 }}>
							{revisions.isError ? (
								<p role="alert" className="text-muted" style={{ padding: 8, fontSize: 13 }}>
									{revisions.error.message}
								</p>
							) : revisions.isPending ? (
								<SkeletonText label="Loading history…" lines={4} style={{ padding: 8 }} />
							) : (
								<ol aria-label={`${items.length} ${items.length === 1 ? "revision" : "revisions"}`}>
									{items.map((revision) => {
										const on = revision.id === selected?.id
										const isCurrentRow = revision.id === artifact.currentRevisionId
										return (
											<li key={revision.id} style={{ marginBottom: 6 }}>
												<button
													type="button"
													aria-pressed={on}
													onClick={() => setSelectedId(revision.id)}
													className={clsx(
														"block w-full border text-left transition-colors duration-(--duration-row) ease-(--ease-arrive) hover:bg-panel",
														on ? "border-ink bg-panel" : "border-transparent",
													)}
													style={{ padding: "12px 14px", borderRadius: 8 }}
												>
													<span className="flex items-center" style={{ gap: 8 }}>
														<span className="font-mono text-ink" style={{ fontSize: 12, fontWeight: 600 }}>
															v{revision.seq}
														</span>
														{isCurrentRow ? <Tag tone="current">Current</Tag> : null}
														{revision.status === "pending" ? <Tag tone="pending">Pending</Tag> : null}
														{revision.status === "discarded" ? <Tag tone="discarded">Discarded</Tag> : null}
														<span className="flex-1" />
														<span className="font-mono whitespace-nowrap text-muted" style={{ fontSize: 11 }}>
															{activityWhen(revision.createdAt)}
														</span>
													</span>
													<span
														className="block text-body"
														style={{ fontSize: 13, lineHeight: 1.45, marginTop: 6, textWrap: "pretty" }}
													>
														{revision.note ?? "No change note"}
													</span>
													<span className="block text-muted" style={{ fontSize: 12, marginTop: 6 }}>
														{authorOf(revision, artifact)}
													</span>
												</button>
												{on ? (
													<div style={{ padding: "0 14px" }}>
														<Provenance revision={revision} />
													</div>
												) : null}
											</li>
										)
									})}
								</ol>
							)}
						</div>
						<p
							className="flex-none border-t border-pane-line text-muted"
							style={{ padding: "12px 20px 16px", fontSize: 12, lineHeight: 1.45 }}
						>
							Restoring writes a new revision, which waits for approval like any other. Nothing is deleted.
						</p>
					</div>

					<div className="flex min-h-0 min-w-0 flex-col">
						{selected ? (
							<>
								<div
									className="flex flex-none items-center border-b border-pane-line"
									style={{ gap: 10, height: 44, padding: "0 24px" }}
								>
									<span
										className="font-mono border border-line-strong"
										style={{ fontSize: 12, fontWeight: 600, padding: "3px 7px", borderRadius: 4 }}
									>
										v{selected.seq}
									</span>
									<span className="min-w-0 truncate text-muted" style={{ fontSize: 13 }}>
										{`${formatSheetDate(selected.createdAt)} · ${authorOf(selected, artifact)}`}
									</span>
									<span className="flex-1" />
									<span className="whitespace-nowrap text-muted" style={{ fontSize: 12 }}>
										{stateLabel}
									</span>
								</div>
								<div className="flex min-h-0 flex-1 flex-col">
									<RevisionPreview key={selected.id} artifact={artifact} revision={selected} />
								</div>
							</>
						) : revisions.isSuccess ? (
							<Notice>No revisions yet.</Notice>
						) : null}
					</div>
				</div>
			</Dialog>
			{comparing && current ? (
				<CompareDialog artifact={artifact} revision={comparing} current={current} onClose={() => setComparing(null)} />
			) : null}
		</>
	)
}
