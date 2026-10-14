import type { FindingType } from "@exagram/redactor"

import type { ArtifactKind } from "../entity/artifact"
import type { RedactionStatus } from "../entity/redaction"

/**
 * The Approver's queue row: the boundary's `PendingRevision` in `visibility.datagateway.ts` carries
 * only ids, this one carries what the screen renders. Distinct names so neither shadows the other.
 */
export interface PendingRevisionDetail {
	revisionId: string
	artifactId: string
	seq: number
	authorUserId: string
	authorConnectionId: string | null
	mime: string
	bytes: number
	note: string | null
	createdAt: Date
	title: string
	kind: ArtifactKind
	ownerId: string
	/** True when the reader approves it (folder owner, else Artifact owner); false for an Author's own. */
	isApprover: boolean
	placeholderTypes: FindingType[]
	redactionStatus: RedactionStatus
	/** The author's display name; the person a Connection wrote for, when one did. */
	authorName: string
	/** The Connection's client name when a Connection wrote it, otherwise null. */
	authorConnectionName: string | null
}

export interface ApprovalsDatagateway {
	listPending(userId: string, workspaceId: string): Promise<PendingRevisionDetail[]>
	/** Returns the approved revision id, or null when the caller is not the Approver or it is not pending. */
	approve(revisionId: string, approverUserId: string, confirmPlaceholders: boolean): Promise<string | null>
	discard(revisionId: string, approverUserId: string): Promise<string | null>
}
