import { RefusalError } from "@exagram/core/utils/refusal"

import type { RevisionsDatagateway } from "@exagram/core/datagateway/revisions.datagateway"
import type { VisibleArtifact } from "@exagram/core/datagateway/visibility.datagateway"
import type { Revision } from "@exagram/core/entity/revision"

/**
 * The one rule for a read that names its Revision (History's text, a Pending Revision's body). It runs
 * inside `serve()`, past the boundary: the Revision it resolved is readable by whoever it reached, a
 * Pending Revision by its author and the Owner, and any other Revision only by the Owner (CONTEXT.md,
 * Owner and Pending Revision). A Revision of another Artifact, or one that does not exist, is refused
 * the same way, so withheld and absent read alike.
 *
 * This only narrows what the boundary already admitted: a reader it withholds the Artifact from never gets
 * here, so the author of a Pending Revision on someone else's Artifact with nothing approved is still refused.
 */
export async function readableRevision(
	revisions: Pick<RevisionsDatagateway, "getInArtifact">,
	userId: string,
	visible: VisibleArtifact,
	revisionId: string,
): Promise<Revision> {
	const revision = await revisions.getInArtifact(revisionId, visible.artifactId)
	if (!revision) throw new RefusalError()
	const ownPending = revision.status === "pending" && revision.authorUserId === userId
	if (revision.id !== visible.revisionId && visible.access !== "owner" && !ownPending) {
		throw new RefusalError()
	}
	return revision
}
