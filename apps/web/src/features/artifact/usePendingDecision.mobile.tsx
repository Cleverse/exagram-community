import { type PendingRevision } from "@exagram/api-client"
import { useRef } from "react"

import { useToast } from "@/components/Toast"
import { ConfirmPlaceholdersDialog } from "@/features/approvals/ConfirmPlaceholdersDialog"
import { useDiscardRevision } from "@/features/approvals/hooks/useApprove"
import { useApproveWithConfirmation } from "@/features/approvals/hooks/useApproveWithConfirmation"

/**
 * Approve and Reject for pending Revisions on a phone, with desktop's semantics: a Connection's Revision with
 * placeholders asks once more before it is approved, and each outcome says so in the same toast as the
 * desktop's Needs your action. `onDecided` runs after either succeeds (the preview drawer closes on it).
 */
export const usePendingDecision = ({ onDecided }: { onDecided?: () => void } = {}) => {
	const toast = useToast()
	const discard = useDiscardRevision()
	// Approving can pass through the placeholder dialog, so the toast finds its Revision again by id.
	const requested = useRef(new Map<string, PendingRevision>())
	const approval = useApproveWithConfirmation({
		onSuccess: (revisionId) => {
			const revision = requested.current.get(revisionId)
			if (revision) toast(`v${revision.seq} of ${revision.title} is now the published version.`)
			onDecided?.()
		},
	})

	return {
		busy: approval.isPending || discard.isPending,
		approve: (revision: PendingRevision) => {
			requested.current.set(revision.revisionId, revision)
			approval.requestApproval(revision)
		},
		reject: (revision: PendingRevision) =>
			discard.mutate(
				{ revisionId: revision.revisionId },
				{
					onSuccess: () => {
						toast(`v${revision.seq} rejected — its author keeps a copy in their drafts.`)
						onDecided?.()
					},
				},
			),
		/** The placeholder confirmation, while one is asked; render it beside the buttons. */
		dialog: approval.confirming ? (
			<ConfirmPlaceholdersDialog
				types={approval.confirming.placeholderTypes ?? []}
				onCancel={approval.cancelConfirmation}
				onConfirm={approval.confirmApproval}
			/>
		) : null,
	}
}

export type PendingDecision = ReturnType<typeof usePendingDecision>
