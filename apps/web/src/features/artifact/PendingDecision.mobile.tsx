import { type PendingRevision } from "@exagram/api-client"

import { useSheet } from "@/components/mobile/sheet/context"
import { edition } from "@/edition/edition"
import { connectionRedactionStatus } from "@/features/approvals/redactionStatus"
import { type PendingDecision } from "@/features/artifact/usePendingDecision.mobile"

/** What stands between a Revision and Approve: placeholders to confirm, or a redaction check still running. */
export const PendingNotes = ({ revision }: { revision: PendingRevision }) => {
	const status = connectionRedactionStatus(revision, edition.redactionCheck)
	const placeholders = revision.authorConnectionId !== null && revision.placeholderTypes.length > 0
	if (!status && !placeholders) return null
	return (
		<div className="text-pending-fg" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
			{placeholders ? (
				<div>{`Sensitive values will become placeholders: ${revision.placeholderTypes.map((type) => `[${type}]`).join(", ")}.`}</div>
			) : null}
			{status ? <div>{status.message}</div> : null}
		</div>
	)
}

/**
 * Opens the Pending Revision's preview drawer. Anyone who sees the Revision may look; the server serves the
 * body to the Owner and its author only, as on desktop.
 */
export const PreviewButton = ({ revision, height }: { revision: PendingRevision; height: number }) => {
	const sheet = useSheet()
	return (
		<button
			type="button"
			onClick={() => sheet.open("pendingPreview", { revisionId: revision.revisionId })}
			className="border border-line-strong bg-panel text-body active:bg-hover"
			style={{ height, borderRadius: 6, fontSize: 14, fontWeight: 500 }}
		>
			Preview
		</button>
	)
}

/**
 * The 2-up Reject / Approve pair (W:L97–100, L271–274): white with a hairline, and the near-black primary.
 * `height` is 40 in the Activity inbox and 38 in the reading view's banner. A Revision still being checked
 * for sensitive values cannot be approved, as on desktop. `preview` puts Preview first, 3-up; the preview
 * drawer itself leaves it off.
 */
export const DecisionButtons = ({
	revision,
	decision,
	height,
	preview = false,
}: {
	revision: PendingRevision
	decision: PendingDecision
	height: number
	preview?: boolean
}) => {
	const redaction = edition.redactionCheck
	return (
		<div className="grid" style={{ gridTemplateColumns: preview ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8 }}>
			{preview ? <PreviewButton revision={revision} height={height} /> : null}
			<button
				type="button"
				disabled={decision.busy}
				onClick={() => decision.reject(revision)}
				className="border border-line-strong bg-panel text-body active:bg-hover disabled:opacity-50"
				style={{ height, borderRadius: 6, fontSize: 14, fontWeight: 500 }}
			>
				Reject
			</button>
			<button
				type="button"
				disabled={decision.busy || Boolean(connectionRedactionStatus(revision, redaction)?.blocksApproval)}
				onClick={() => decision.approve(revision)}
				className="bg-ink text-white active:bg-primary-hover disabled:opacity-50"
				style={{ height, borderRadius: 6, fontSize: 14, fontWeight: 500 }}
			>
				Approve
			</button>
		</div>
	)
}
