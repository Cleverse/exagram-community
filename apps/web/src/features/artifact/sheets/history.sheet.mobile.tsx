import { type Revision, type VisibleArtifact } from "@exagram/api-client"
import clsx from "clsx"
import { useState } from "react"

import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { useToast } from "@/components/Toast"
import { SkeletonText } from "@/components/ui/Skeleton"
import { restoredMessage, useRestoreAsNew, useRevisions } from "@/features/artifact/hooks/useRevisions"
import { authorOf } from "@/features/artifact/reading/revision"
import { useSheetArtifact } from "@/features/artifact/sheets/sheetData"
import { SheetGone, SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { activityWhen } from "@/features/library/lastActivity"

/** The badge beside the author: Current in green, Pending in amber; a discarded one says so in grey. */
const Badge = ({ revision, isCurrent }: { revision: Revision; isCurrent: boolean }) => {
	const badge =
		revision.status === "pending"
			? { text: "Pending", className: "text-pending-fg", background: "rgba(217,134,11,.2)" }
			: isCurrent
				? { text: "Current", className: "bg-green-bg text-green-fg" }
				: revision.status === "discarded"
					? { text: "Discarded", className: "bg-row-selected text-muted" }
					: null
	if (!badge) return null
	return (
		<span
			className={clsx("flex-none", badge.className)}
			style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: badge.background }}
		>
			{badge.text}
		</span>
	)
}

const HistoryList = ({ artifact }: { artifact: VisibleArtifact }) => {
	const revisions = useRevisions(artifact.id, true)
	const restore = useRestoreAsNew(artifact.id)
	const sheet = useSheet()
	const toast = useToast()
	const [selectedId, setSelectedId] = useState<string | null>(null)

	const items = [...(revisions.data ?? [])].sort((a, b) => b.seq - a.seq)

	return (
		<Sheet title="Version history" sub={artifact.title}>
			<div style={{ padding: "0 6px 12px" }}>
				{revisions.isError ? (
					<SheetNote role="alert">{revisions.error.message}</SheetNote>
				) : revisions.isPending ? (
					<SkeletonText label="Loading history…" lines={4} style={{ padding: "8px 10px" }} />
				) : (
					<ol>
						{items.map((revision) => {
							const isCurrent = revision.id === artifact.currentRevisionId
							const isPending = revision.status === "pending"
							const selected = revision.id === selectedId
							// As desktop: only an approved Revision that is no longer current is worth restoring.
							const canRestore = revision.status === "approved" && !isCurrent
							return (
								<li
									key={revision.id}
									className={clsx(selected ? "bg-row-selected" : isPending ? "bg-pending-bg" : undefined)}
									style={{ borderRadius: 6, marginBottom: 2 }}
								>
									<button
										type="button"
										aria-pressed={selected}
										onClick={() => setSelectedId(selected ? null : revision.id)}
										className="flex w-full items-start text-left"
										style={{ gap: 12, padding: "12px 10px" }}
									>
										<span className="flex-none font-mono" style={{ width: 28, fontSize: 13, fontWeight: 600 }}>
											v{revision.seq}
										</span>
										<span className="min-w-0 flex-1">
											<span className="flex items-center" style={{ gap: 8 }}>
												<span className="truncate" style={{ fontSize: 14.5, fontWeight: 500 }}>
													{authorOf(revision, artifact)}
												</span>
												<Badge revision={revision} isCurrent={isCurrent} />
											</span>
											<span className="block text-muted-2" style={{ fontSize: 12.5, marginTop: 2 }}>
												{activityWhen(revision.createdAt)} · {revision.note ?? "No change note"}
											</span>
										</span>
									</button>
									{selected && canRestore ? (
										<div style={{ padding: "0 10px 12px 50px" }}>
											<button
												type="button"
												disabled={restore.isPending}
												onClick={() =>
													restore.mutate(
														{ revisionId: revision.id },
														{
															onSuccess: (created) => {
																toast(restoredMessage(revision.seq, created))
																sheet.close()
															},
															onError: (error) => toast(error.message),
														},
													)
												}
												className="w-full bg-ink text-white active:bg-primary-hover disabled:opacity-50"
												style={{ height: 36, fontSize: 14, fontWeight: 500 }}
											>
												{restore.isPending ? "Restoring…" : `Restore v${revision.seq}`}
											</button>
										</div>
									) : null}
								</li>
							)
						})}
					</ol>
				)}
				<p className="text-muted" style={{ padding: "8px 10px 0", fontSize: 12.5, lineHeight: 1.45 }}>
					Restoring writes a new revision, which waits for approval like any other. Nothing is deleted.
				</p>
			</div>
		</Sheet>
	)
}

/**
 * Version history: every Revision newest first, vN, who, badge, when and note. Tapping an older
 * approved one offers Restore, which writes a new Revision as desktop's History panel does. Compare is left
 * out on the phone (plan decision 5). Revisions are the Owner's to list, so the File drawer offers this to
 * the Owner only.
 */
const HistorySheet = ({ params }: { params: SheetParams["history"] }) => {
	const { artifact, loading } = useSheetArtifact(params.artifactId)
	if (loading) return <SheetLoading title="Version history" />
	if (!artifact) return <SheetGone />
	if (artifact.access !== "owner") {
		return (
			<Sheet title="Version history" sub={artifact.title}>
				<SheetNote>Only the file&apos;s owner can see its history.</SheetNote>
			</Sheet>
		)
	}
	return <HistoryList artifact={artifact} />
}

export default HistorySheet
