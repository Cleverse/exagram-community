import { type Project, type VisibleArtifact } from "@exagram/api-client"

import { type RecapFile, type RecapProject } from "@/features/context/recap"

/** A local calendar date as a day number, so a 23h or 25h DST day still counts as exactly one day. */
const dayNumber = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000

/** The recap reads ages, not dates: whole calendar days back, in the `"3d"` spelling the sample uses. */
export const agePhrase = (updatedAt: Date | string, today: Date) =>
	`${Math.max(0, dayNumber(today) - dayNumber(new Date(updatedAt)))}d`

export const recapFileOf = (artifact: VisibleArtifact, today: Date): RecapFile => ({
	id: artifact.id,
	name: artifact.title,
	type: artifact.kind,
	rev: `v${artifact.revisionSeq ?? 1}`,
	updated: agePhrase(artifact.updatedAt, today),
	projectId: artifact.projectId,
	owner: artifact.ownerName,
	// The meta line counts everyone but the owner, whom the sample keeps at the head of this list.
	shared: [artifact.ownerName, ...artifact.sharedWithNames],
})

export const recapProjectOf = (project: Project): RecapProject => ({ id: project.id, name: project.name })
