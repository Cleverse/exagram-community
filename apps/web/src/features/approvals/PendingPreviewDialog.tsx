import { type ArtifactKind } from "@exagram/api-client"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { RevisionPreview } from "@/features/artifact/reading/RevisionPreview"

type PreviewedRevision = {
	artifactId: string
	revisionId: string
	seq: number
	title: string
	kind: ArtifactKind
	note?: string | null
}

/** The caller's own Approve / Reject, so the dialog decides with exactly the gating the row or banner has. */
type Decision = {
	busy: boolean
	/** A Connection's Revision still being checked for sensitive values cannot be approved (redactionStatus). */
	blocksApproval: boolean
	/** "Reject" in the approval lists, "Discard" in the reading view's banner. */
	rejectLabel?: string
	helper?: string
	onApprove: () => void
	onReject: () => void
}

/**
 * A Pending Revision's content before it is decided (CONTEXT.md, Pending Revision). Anyone who sees the row
 * may open it; the server serves the body only to the Owner or the Revision's own author, and anyone else
 * reads the one unavailable message. `decision` is the Owner's alone; deciding closes the preview, since the
 * Revision leaves the queue.
 */
export const PendingPreviewDialog = ({
	revision,
	decision,
	onClose,
}: {
	revision: PreviewedRevision
	decision?: Decision
	onClose: () => void
}) => {
	const title = `${revision.title} · v${revision.seq} · Pending`
	return (
		<Dialog
			title={title}
			onClose={onClose}
			width={1180}
			scrim={0.4}
			bare
			helper={decision?.helper}
			cardStyle={{
				height: "min(820px, calc(100vh - 48px))",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
			footer={
				<>
					<Button variant="outline" size={40} onClick={onClose}>
						Close
					</Button>
					{decision ? (
						<>
							<Button
								variant="outline"
								size={40}
								disabled={decision.busy}
								onClick={() => {
									decision.onReject()
									onClose()
								}}
							>
								{decision.rejectLabel ?? "Reject"}
							</Button>
							<Button
								variant="approve"
								size={40}
								disabled={decision.busy || decision.blocksApproval}
								onClick={() => {
									decision.onApprove()
									onClose()
								}}
							>
								Approve
							</Button>
						</>
					) : null}
				</>
			}
		>
			{revision.note ? (
				<p
					className="flex-none border-b border-pending-line bg-pending-bg text-pending-fg"
					style={{ padding: "10px 24px", fontSize: 13 }}
				>
					{revision.note}
				</p>
			) : null}
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				<RevisionPreview
					// A Pending Revision is never the one the boundary resolved, so its body is always asked for by name.
					artifact={{ id: revision.artifactId, kind: revision.kind, title: revision.title, visibleRevisionId: null }}
					revision={{ id: revision.revisionId, seq: revision.seq }}
				/>
			</div>
		</Dialog>
	)
}
