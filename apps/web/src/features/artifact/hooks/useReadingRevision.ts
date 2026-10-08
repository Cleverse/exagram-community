import { type VisibleArtifact } from "@exagram/api-client"

import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"

/** Which Revision a reading surface draws, and whether it is a Pending one read by id. */
export type ReadingRevision = { revisionId: string | null; pending: boolean }

/**
 * The Revision the boundary serves; before anything is approved, the Pending one the approval queue holds
 * for this reader (their own draft, or as Owner anyone's), so it can be read before Approve. The server
 * still judges every read: this only picks which endpoint asks.
 */
export const readingRevisionOf = (
	artifact: Pick<VisibleArtifact, "id" | "visibleRevisionId">,
	queue: readonly { artifactId: string; revisionId: string }[] | undefined,
): ReadingRevision => {
	if (artifact.visibleRevisionId !== null) return { revisionId: artifact.visibleRevisionId, pending: false }
	const waiting = queue?.find((revision) => revision.artifactId === artifact.id) ?? null
	return { revisionId: waiting?.revisionId ?? null, pending: waiting !== null }
}

export const useReadingRevision = (artifact: Pick<VisibleArtifact, "id" | "visibleRevisionId">): ReadingRevision =>
	readingRevisionOf(artifact, usePendingRevisions().data)
