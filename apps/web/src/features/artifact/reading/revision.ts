import { type Revision, type VisibleArtifact } from "@exagram/api-client"

/** The list carries ids, not names: only the owner's own name is knowable from the artifact. */
export const authorOf = (revision: Revision, artifact: VisibleArtifact): string =>
	revision.authorConnectionId !== null
		? "via a Connection"
		: revision.authorUserId === artifact.ownerId
			? artifact.ownerName
			: "a collaborator"
