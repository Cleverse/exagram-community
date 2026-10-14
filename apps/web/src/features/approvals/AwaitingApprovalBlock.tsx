import { type ArtifactKind, type FindingType, type PendingRevision, type VisibleArtifact } from "@exagram/api-client"
import { useState } from "react"
import { Link } from "react-router"

import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { MonoKicker } from "@/components/ui/Mono"
import { TypeTile } from "@/components/ui/TypeTile"
import { edition } from "@/edition/edition"
import { pendingAuthor } from "@/features/activity/activityFeed"
import { ConfirmPlaceholdersDialog } from "@/features/approvals/ConfirmPlaceholdersDialog"
import { useDiscardRevision } from "@/features/approvals/hooks/useApprove"
import { useApproveWithConfirmation } from "@/features/approvals/hooks/useApproveWithConfirmation"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { PendingPreviewDialog } from "@/features/approvals/PendingPreviewDialog"
import { connectionRedactionStatus } from "@/features/approvals/redactionStatus"
import { artifactLinkTarget } from "@/features/artifact/openArtifact"
import { useMe } from "@/features/auth/hooks/useMe"
import { paths } from "@/routes/paths"

type AwaitingRevision = {
	revisionId: string
	artifactId: string
	title: string
	kind: ArtifactKind
	/** The Revision Connections keep reading until this one is approved. */
	currentRev: string
	seq: number
	/** The folder the file sits in, when the list is grouped by its Project. */
	folder?: string
	nextRev: string
	note: string
	isOwner: boolean
	authorConnectionId?: string | null
	placeholderTypes?: FindingType[]
	redactionStatus?: PendingRevision["redactionStatus"]
}

const isConnectionRevision = (revision: AwaitingRevision): boolean =>
	revision.authorConnectionId !== null && revision.authorConnectionId !== undefined

/** Presentation only, so the wording and the owner gate are testable without a server. */
export const AwaitingApprovalBlockView = ({
	revisions,
	onApprove,
	onReject,
	busy,
	confirmationRevisionId,
	onConfirm,
	onCancelConfirmation,
	heading = true,
	wide = true,
}: {
	revisions: AwaitingRevision[]
	onApprove: (revisionId: string) => void
	onReject: (revisionId: string) => void
	busy: boolean
	confirmationRevisionId?: string | null
	onConfirm?: () => void
	onCancelConfirmation?: () => void
	/** The Activity screen draws its own per-project header, so it turns the kicker and spacer off. */
	heading?: boolean
	/** Room for the mono `v3 → v4` step; the open preview pane takes it away. */
	wide?: boolean
}) => {
	const confirming = revisions.find((revision) => revision.revisionId === confirmationRevisionId) ?? null
	const [previewId, setPreviewId] = useState<string | null>(null)
	const previewing = revisions.find((revision) => revision.revisionId === previewId) ?? null
	const redaction = edition.redactionCheck
	const previewStatus = previewing === null ? null : connectionRedactionStatus(previewing, redaction)

	if (revisions.length === 0) return null

	return (
		<div>
			{heading ? (
				<MonoKicker className="flex items-center" style={{ padding: "22px 10px 8px", gap: 10 }}>
					<span style={{ width: 8, height: 8, background: "var(--color-pending)" }} aria-hidden />
					Awaiting approval · {revisions.length}
				</MonoKicker>
			) : null}
			<ul>
				{revisions.map((revision) => (
					<li
						key={revision.revisionId}
						className="flex items-center transition-colors duration-(--duration-row) ease-(--ease-arrive) hover:bg-pending-bg"
						style={{
							gap: 12,
							minHeight: 52,
							padding: "6px 8px 6px 12px",
							borderBottom: "1px solid var(--color-row-line)",
						}}
					>
						<TypeTile kind={revision.kind} />
						<div className="min-w-0 flex-1">
							<Link
								to={paths.artifact(revision.artifactId)}
								target={artifactLinkTarget()}
								className="block max-w-full truncate text-left text-ink hover:text-link-hover"
								style={{ fontSize: 14, fontWeight: 500 }}
							>
								{revision.title}
								{revision.folder ? (
									<span className="text-muted" style={{ fontWeight: 400 }}>{` › ${revision.folder}`}</span>
								) : null}
							</Link>
							<div className="truncate text-muted" style={{ fontSize: 12, marginTop: 1 }}>
								<span aria-hidden>⚠ </span>
								{revision.note}
							</div>
							{isConnectionRevision(revision) && (revision.placeholderTypes?.length ?? 0) > 0 ? (
								<div className="text-pending-fg" style={{ fontSize: 12, marginTop: 2 }}>
									Sensitive values will become placeholders:{" "}
									{revision.placeholderTypes?.map((type) => `[${type}]`).join(", ")}.
								</div>
							) : null}
							{connectionRedactionStatus(revision, redaction) ? (
								<div className="text-pending-fg" style={{ fontSize: 12, marginTop: 2 }}>
									{connectionRedactionStatus(revision, redaction)?.message}
								</div>
							) : null}
						</div>
						{wide ? (
							<div className="font-mono flex-none whitespace-nowrap text-muted" style={{ fontSize: 12 }}>
								{/* A first upload has nothing before it, so the step is just its number. */}
								{revision.currentRev === "—" ? null : `${revision.currentRev} → `}
								<strong className="text-ink">{revision.nextRev}</strong>
							</div>
						) : null}
						{/* Anyone who sees the row may look; the server serves the body to the Owner and the author only. */}
						<Button variant="quiet" size={30} onClick={() => setPreviewId(revision.revisionId)}>
							Preview
						</Button>
						{revision.isOwner ? (
							<>
								<Button variant="quiet" size={30} disabled={busy} onClick={() => onReject(revision.revisionId)}>
									Reject
								</Button>
								<Button
									variant="approve"
									size={30}
									disabled={busy || Boolean(connectionRedactionStatus(revision, redaction)?.blocksApproval)}
									onClick={() => onApprove(revision.revisionId)}
								>
									Approve
								</Button>
							</>
						) : (
							<span className="flex-none text-muted" style={{ fontSize: 13 }}>
								Waiting for the Owner
							</span>
						)}
					</li>
				))}
			</ul>
			{heading ? <div style={{ height: 14 }} /> : null}
			{previewing ? (
				<PendingPreviewDialog
					revision={{
						artifactId: previewing.artifactId,
						revisionId: previewing.revisionId,
						seq: previewing.seq,
						title: previewing.title,
						kind: previewing.kind,
						note: previewing.note,
					}}
					decision={
						previewing.isOwner
							? {
									busy,
									blocksApproval: Boolean(previewStatus?.blocksApproval),
									helper: previewStatus?.message,
									onApprove: () => onApprove(previewing.revisionId),
									onReject: () => onReject(previewing.revisionId),
								}
							: undefined
					}
					onClose={() => setPreviewId(null)}
				/>
			) : null}
			{confirming ? (
				<ConfirmPlaceholdersDialog
					types={confirming.placeholderTypes ?? []}
					onCancel={() => onCancelConfirmation?.()}
					onConfirm={() => onConfirm?.()}
				/>
			) : null}
		</div>
	)
}

export const AwaitingApprovalBlock = ({
	artifacts,
	folders,
	heading = true,
	wide = true,
}: {
	artifacts: VisibleArtifact[]
	/** Each file's folder by Artifact id, shown after its title. */
	folders?: Map<string, string>
	heading?: boolean
	wide?: boolean
}) => {
	const pending = usePendingRevisions()
	const me = useMe()
	const discard = useDiscardRevision()
	const toast = useToast()

	const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
	const revisions: AwaitingRevision[] = (pending.data ?? [])
		.filter((revision) => byId.has(revision.artifactId))
		.map((revision) => {
			const artifact = byId.get(revision.artifactId)
			const currentRev = artifact === undefined || artifact.revisionSeq === null ? "—" : `v${artifact.revisionSeq}`
			const author = pendingAuthor(revision, me.data?.id ?? null)

			return {
				revisionId: revision.revisionId,
				artifactId: revision.artifactId,
				title: revision.title,
				kind: revision.kind,
				currentRev,
				seq: revision.seq,
				folder: folders?.get(revision.artifactId),
				nextRev: `v${revision.seq}`,
				// "v4 waiting · from Grace · <their note>", or "your upload" for the reader's own.
				note: [
					`v${revision.seq} waiting`,
					author === "You" ? "your upload" : `from ${author}`,
					revision.note ?? (currentRev === "—" ? "not published yet" : `Connections still read ${currentRev}`),
				].join(" · "),
				isOwner: revision.isApprover,
				authorConnectionId: revision.authorConnectionId,
				placeholderTypes: revision.placeholderTypes,
				redactionStatus: revision.redactionStatus,
			}
		})

	const find = (revisionId: string) => revisions.find((candidate) => candidate.revisionId === revisionId)
	const approval = useApproveWithConfirmation({
		onSuccess: (revisionId) => {
			const revision = find(revisionId)
			if (revision) toast(`${revision.nextRev} of ${revision.title} is now the published version.`)
		},
	})

	return (
		<AwaitingApprovalBlockView
			revisions={revisions}
			heading={heading}
			wide={wide}
			busy={approval.isPending || discard.isPending}
			confirmationRevisionId={approval.confirming?.revisionId ?? null}
			onConfirm={approval.confirmApproval}
			onCancelConfirmation={approval.cancelConfirmation}
			onApprove={(revisionId) => {
				const revision = find(revisionId)
				if (revision) approval.requestApproval(revision)
			}}
			onReject={(revisionId) => {
				const revision = find(revisionId)
				discard.mutate(
					{ revisionId },
					{
						onSuccess: () => {
							if (revision) toast(`${revision.nextRev} rejected — its author keeps a copy in their drafts.`)
						},
					},
				)
			}}
		/>
	)
}
