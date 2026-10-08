import { type VisibleArtifact } from "@exagram/api-client"

/** The prototype's recency buckets, in its order and its casing; v3 shows them sentence case, as written. */
export const GROUP_LABELS = ["Today", "Yesterday", "Earlier this week", "Last week", "Older"] as const

export type ArtifactGroupLabel = (typeof GROUP_LABELS)[number]

export interface ArtifactGroup {
	label: ArtifactGroupLabel
	artifacts: VisibleArtifact[]
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** Whole calendar days back, so a row never changes bucket at a rolling 24h mark. */
const bucketFor = (updatedAt: Date | string, today: number): ArtifactGroupLabel => {
	const days = Math.floor((today - startOfDay(new Date(updatedAt))) / 86_400_000)
	if (days <= 0) return "Today"
	if (days === 1) return "Yesterday"
	if (days <= 7) return "Earlier this week"
	if (days <= 14) return "Last week"
	return "Older"
}

/**
 * Buckets by the recency of `updatedAt`, preserving the order artifacts already arrive in and
 * dropping empty buckets. Groups always come back in `GROUP_LABELS` order.
 */
export const groupArtifactsByRecency = (artifacts: VisibleArtifact[]): ArtifactGroup[] => {
	const today = startOfDay(new Date())
	const byLabel = new Map<ArtifactGroupLabel, VisibleArtifact[]>()

	for (const artifact of artifacts) {
		const label = bucketFor(artifact.updatedAt, today)
		const existing = byLabel.get(label)
		if (existing) existing.push(artifact)
		else byLabel.set(label, [artifact])
	}

	return GROUP_LABELS.flatMap((label) => {
		const items = byLabel.get(label)
		return items ? [{ label, artifacts: items }] : []
	})
}
