import type { AnyoneGate } from "../entity/artifact"
import type { Access, Principal } from "../entity/principal"

export interface VisibleArtifact {
	artifactId: string
	/** Null means the artifact has no approved revision yet; only an owner ever sees this. */
	revisionId: string | null
	access: Access
	/** False for a reader Anyone with the link admits while its Owner withheld download. */
	download: boolean
}

export interface PendingRevision {
	revisionId: string
	artifactId: string
	seq: number
	authorUserId: string
	authorConnectionId: string | null
	createdAt: Date
	isApprover: boolean
}

/**
 * Which SQL function answers a single-Artifact read. `visible` is `exagram.visible_artifact`, the one a
 * read of the body goes through. `commentable` is `exagram.commentable_artifact`: the same row, minus
 * the readers General Access 'anyone' admits from outside the Artifact's Workspace, who read at view
 * and do nothing more. A Grant row answers both the same way.
 */
export type Boundary = "visible" | "commentable"

export interface VisibleRead {
	/** `visible` unless given. */
	boundary?: Boundary
	/**
	 * The sha256 of the reader's unlock cookie for this Artifact, forwarded as it is. Only SQL
	 * decides whether it opens anything.
	 */
	unlockHash?: string
}

export interface VisibilityDatagateway {
	listVisible(principal: Principal): Promise<VisibleArtifact[]>
	getVisible(principal: Principal, artifactId: string, options?: VisibleRead): Promise<VisibleArtifact | null>
	/**
	 * Which gate stopped a reader that `getVisible` found no row for, or null when none did and the miss
	 * is a plain refusal. Asked only after such a miss.
	 */
	anyoneGate(principal: Principal, artifactId: string, unlockHash?: string): Promise<AnyoneGate | null>
	listPendingRevisions(userId: string, workspaceId: string): Promise<PendingRevision[]>
}
