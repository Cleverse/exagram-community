import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { DecisionButtons, PendingNotes } from "@/features/artifact/PendingDecision.mobile"
import { RevisionPreview } from "@/features/artifact/reading/RevisionPreview"
import { SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { usePendingDecision } from "@/features/artifact/usePendingDecision.mobile"

/**
 * A Pending Revision's content on a phone, desktop's PendingPreviewDialog as a drawer. The queue holds only
 * what this person may see; the server serves the body to the Owner and the author only. Reject / Approve are
 * the Owner's, with the same gating as the inbox; deciding closes the drawer, as desktop's dialog closes. If
 * the Revision leaves the queue some other way, the drawer says so.
 */
const PendingPreviewSheet = ({ params }: { params: SheetParams["pendingPreview"] }) => {
	const pending = usePendingRevisions()
	const sheet = useSheet()
	const decision = usePendingDecision({ onDecided: sheet.close })
	const revision = pending.data?.find((candidate) => candidate.revisionId === params.revisionId)

	if (pending.isPending) return <SheetLoading title="Preview" />
	if (!revision)
		return (
			<Sheet title="Preview">
				<SheetNote>This version is no longer waiting for approval.</SheetNote>
			</Sheet>
		)

	const isOwner = revision.isApprover
	return (
		<Sheet title={`v${revision.seq} · Pending`} sub={revision.title} full>
			<div className="flex flex-col" style={{ height: "calc(100dvh - 240px)", minHeight: 360 }}>
				<RevisionPreview
					// A Pending Revision is never the one the boundary resolved, so its body is always asked for by name.
					artifact={{ id: revision.artifactId, kind: revision.kind, title: revision.title, visibleRevisionId: null }}
					revision={{ id: revision.revisionId, seq: revision.seq }}
				/>
			</div>
			{isOwner ? (
				<div className="flex flex-col" style={{ gap: 8, padding: "12px 16px 16px" }}>
					<PendingNotes revision={revision} />
					<DecisionButtons revision={revision} decision={decision} height={40} />
				</div>
			) : null}
			{decision.dialog}
		</Sheet>
	)
}

export default PendingPreviewSheet
