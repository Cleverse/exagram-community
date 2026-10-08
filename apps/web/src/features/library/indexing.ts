import { type VisibleArtifact } from "@exagram/api-client"

/**
 * Whether a file is still being indexed: its visible Revision's text is queued for extraction. A file with no
 * extraction to do (`none`) or one that ended (`done`, `failed`) is not. The `revisions` live event clears it
 * when extraction ends (`liveKeys.ts`).
 */
export const isIndexing = (artifact: Pick<VisibleArtifact, "extractionStatus">) =>
	artifact.extractionStatus === "queued"
