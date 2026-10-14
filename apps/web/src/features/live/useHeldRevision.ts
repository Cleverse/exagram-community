import { type VisibleArtifact } from "@exagram/api-client"
import { useMemo, useState } from "react"

type Served = Pick<VisibleArtifact, "visibleRevisionId" | "currentRevisionId" | "revisionSeq">

type Hold = {
	artifactId: string
	/** The Revision on the reader's screen. */
	shown: Served
	/** The Revision the server last served, so a change is acted on once, when it arrives. */
	seen: string | null
}

const servedOf = (artifact: VisibleArtifact): Served => ({
	visibleRevisionId: artifact.visibleRevisionId,
	currentRevisionId: artifact.currentRevisionId,
	revisionSeq: artifact.revisionSeq,
})

const holdOf = (artifact: VisibleArtifact): Hold => ({
	artifactId: artifact.id,
	shown: servedOf(artifact),
	seen: artifact.visibleRevisionId,
})

/**
 * Keeps the body under a reader when a new Current Revision is served (a live `current` refetches the list
 * that holds `artifact`). It swaps in only when the reader was on the latest Revision and `canSwap` (not in
 * Compare or Present); otherwise the Revision on show stays and `newer` is true until `view()`.
 *
 * It follows what the server serves, never the event alone: a pinned grantee's served Revision does not
 * move, so they are never told a newer one exists.
 */
export const useHeldRevision = (artifact: VisibleArtifact, canSwap: boolean) => {
	const [hold, setHold] = useState<Hold>(() => holdOf(artifact))

	// Adjusting state while rendering, as React documents for "state from a prop change": no effect, so the
	// new body never paints for one frame first.
	let next = hold
	if (hold.artifactId !== artifact.id) next = holdOf(artifact)
	else if (artifact.visibleRevisionId !== hold.seen) {
		const onLatest = hold.shown.visibleRevisionId === hold.seen
		next = onLatest && canSwap ? holdOf(artifact) : { ...hold, seen: artifact.visibleRevisionId }
	}
	if (next !== hold) setHold(next)
	const shown = next.shown
	const held = useMemo(() => ({ ...artifact, ...shown }), [artifact, shown])

	return {
		/** `artifact` as the reader sees it: the held Revision's id, seq and Current Revision. */
		artifact: held,
		newer: next.shown.visibleRevisionId !== artifact.visibleRevisionId,
		view: () => setHold(holdOf(artifact)),
	}
}
