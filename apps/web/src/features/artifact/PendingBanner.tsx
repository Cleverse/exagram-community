import { type ArtifactKind, type FindingType, type PendingRevision } from "@exagram/api-client"
import { useState } from "react"

import { edition } from "@/edition/edition"
import { ConfirmPlaceholdersDialog } from "@/features/approvals/ConfirmPlaceholdersDialog"
import { useDiscardRevision } from "@/features/approvals/hooks/useApprove"
import { useApproveWithConfirmation } from "@/features/approvals/hooks/useApproveWithConfirmation"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { PendingPreviewDialog } from "@/features/approvals/PendingPreviewDialog"
import { connectionRedactionStatus } from "@/features/approvals/redactionStatus"

type PendingSummary = {
	revisionId: string
	artifactId: string
	title: string
	kind: ArtifactKind
	seq: number
	note: string | null
	authorConnectionId?: string | null
	placeholderTypes?: FindingType[]
	redactionStatus?: PendingRevision["redactionStatus"]
}

const isConnectionRevision = (pending: PendingSummary): boolean =>
	pending.authorConnectionId !== null && pending.authorConnectionId !== undefined

/** Presentation only, so the wording and the owner gate are testable without a server. */
export const PendingBannerView = ({
	pending,
	isOwner,
	onApprove,
	onDiscard,
	busy,
	confirmationRevisionId,
	onConfirm,
	onCancelConfirmation,
}: {
	pending: PendingSummary | null
	isOwner: boolean
	onApprove: (revisionId: string) => void
	onDiscard: (revisionId: string) => void
	busy: boolean
	confirmationRevisionId?: string | null
	onConfirm?: () => void
	onCancelConfirmation?: () => void
}) => {
	const needsConfirmation =
		pending !== null && isConnectionRevision(pending) && (pending.placeholderTypes?.length ?? 0) > 0
	const redaction = edition.redactionCheck
	const redactionStatus = pending === null ? null : connectionRedactionStatus(pending, redaction)
	const [previewing, setPreviewing] = useState(false)

	if (!pending) return null

	// The author reads their own draft here too; the server serves the body to them and the Owner only.
	const preview = (
		<button
			type="button"
			className="border-line-strong hover:bg-panel border px-3.5 py-1.5"
			onClick={() => setPreviewing(true)}
		>
			Preview
		</button>
	)

	return (
		<div role="status" className="flex items-center gap-3 border-b border-pending-line bg-pending-bg px-4 py-3 text-sm">
			<span className="size-2 shrink-0 bg-pending" aria-hidden />
			<span className="font-medium">v{pending.seq} is Pending.</span>
			{pending.note ? <span className="text-muted truncate">{pending.note}</span> : null}
			{isOwner ? (
				<span className="ml-auto flex shrink-0 gap-2">
					{preview}
					<button
						type="button"
						className="border-line-strong hover:bg-panel border px-3.5 py-1.5"
						disabled={busy}
						onClick={() => onDiscard(pending.revisionId)}
					>
						Discard
					</button>
					<button
						type="button"
						className="press bg-primary text-white hover:bg-primary-hover px-4 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
						disabled={busy || Boolean(redactionStatus?.blocksApproval)}
						onClick={() => onApprove(pending.revisionId)}
					>
						Approve
					</button>
				</span>
			) : (
				<span className="ml-auto flex shrink-0 items-center gap-3">
					<span className="text-muted">It is waiting for the Owner.</span>
					{preview}
				</span>
			)}
			{needsConfirmation ? (
				<div className="w-full text-[13px] text-pending-fg">
					Sensitive values will become placeholders: {pending.placeholderTypes?.map((type) => `[${type}]`).join(", ")}.
				</div>
			) : null}
			{redactionStatus ? <div className="w-full text-[13px] text-pending-fg">{redactionStatus.message}</div> : null}
			{previewing ? (
				<PendingPreviewDialog
					revision={pending}
					decision={
						isOwner
							? {
									busy,
									blocksApproval: Boolean(redactionStatus?.blocksApproval),
									helper: redactionStatus?.message,
									rejectLabel: "Discard",
									onApprove: () => onApprove(pending.revisionId),
									onReject: () => onDiscard(pending.revisionId),
								}
							: undefined
					}
					onClose={() => setPreviewing(false)}
				/>
			) : null}
			{confirmationRevisionId === pending.revisionId ? (
				<ConfirmPlaceholdersDialog
					types={pending.placeholderTypes ?? []}
					onCancel={() => onCancelConfirmation?.()}
					onConfirm={() => onConfirm?.()}
				/>
			) : null}
		</div>
	)
}

export const PendingBanner = ({ artifactId }: { artifactId: string }) => {
	const pendingList = usePendingRevisions()
	const discard = useDiscardRevision()
	const approval = useApproveWithConfirmation()

	// The queue already holds only what this caller may see: their own drafts and, as Owner, others'.
	const match = pendingList.data?.find((revision) => revision.artifactId === artifactId) ?? null

	return (
		<PendingBannerView
			pending={
				match
					? {
							revisionId: match.revisionId,
							artifactId: match.artifactId,
							title: match.title,
							kind: match.kind,
							seq: match.seq,
							note: match.note,
							authorConnectionId: match.authorConnectionId,
							placeholderTypes: match.placeholderTypes,
							redactionStatus: match.redactionStatus,
						}
					: null
			}
			// The server names the Approver; `access` is "owner" for an Author who owns a file in someone's folder too.
			isOwner={match?.isApprover ?? false}
			busy={approval.isPending || discard.isPending}
			confirmationRevisionId={approval.confirming?.revisionId ?? null}
			onConfirm={approval.confirmApproval}
			onCancelConfirmation={approval.cancelConfirmation}
			onApprove={() => {
				if (match) approval.requestApproval(match)
			}}
			onDiscard={(revisionId) => discard.mutate({ revisionId })}
		/>
	)
}
