import { type PendingRevision } from "@exagram/api-client"

type RedactionRevision = {
	authorConnectionId?: string | null
	redactionStatus?: PendingRevision["redactionStatus"]
}

/** `redaction` is `edition.redactionCheck`: without it, nothing mentions sensitive values. */
export const connectionRedactionStatus = (revision: RedactionRevision, redaction: boolean) => {
	if (revision.authorConnectionId === null || revision.authorConnectionId === undefined) return null
	if (revision.redactionStatus === undefined || revision.redactionStatus === "done") return null

	const message =
		revision.redactionStatus === "failed"
			? "The check for sensitive values failed and will be retried."
			: revision.redactionStatus === "too_large"
				? "Too large to check for sensitive values, so it cannot be approved. Discard it."
				: redaction
					? "Being checked for sensitive values"
					: "Being prepared for review"

	return { message, blocksApproval: true }
}

/**
 * True while a Connection's Pending Revision still waits on the redaction worker. `too_large` is final,
 * and `failed` is retried by the sweep, so both of those, like `queued`, can still change under the Owner.
 */
export const redactionInFlight = (revisions: readonly RedactionRevision[]) =>
	revisions.some(
		(revision) => connectionRedactionStatus(revision, true) !== null && revision.redactionStatus !== "too_large",
	)
