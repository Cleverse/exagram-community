import { type PendingRevision, type Project, type VisibleArtifact } from "@exagram/api-client"

import { locationOf } from "@/features/activity/location"

export type NeedsActionGroup = {
	/** The top-level Project, or null for files in no Project. */
	project: Project | null
	artifacts: VisibleArtifact[]
	/** The Revisions waiting in this group: what "N revisions" and the heading's total count. */
	count: number
	/** Each file's folder inside the Project, for the rows' "› folder". */
	folders: Map<string, string>
}

/**
 * The Revisions the reader approves, grouped by the top-level Project their file sits in (a file in a
 * folder counts under the folder's Project). A pending Revision whose file the reader cannot list is left
 * out: they could not act on it here.
 */
export const needsActionGroups = ({
	pending,
	artifacts,
	projects,
}: {
	pending: PendingRevision[]
	artifacts: VisibleArtifact[]
	projects: Project[]
}): NeedsActionGroup[] => {
	const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
	const groups = new Map<string | null, NeedsActionGroup>()
	for (const revision of pending) {
		// The server decides who approves (the folder's owner, else the file's); the queue also holds the
		// reader's own drafts as Author.
		if (!revision.isApprover) continue
		const artifact = artifactById.get(revision.artifactId)
		if (artifact === undefined) continue
		const location = locationOf(artifact.projectId, projects)
		const key = location.project?.id ?? null
		const group: NeedsActionGroup = groups.get(key) ?? {
			project: location.project,
			artifacts: [],
			count: 0,
			folders: new Map(),
		}
		if (!group.artifacts.includes(artifact)) group.artifacts.push(artifact)
		if (location.folder !== null && !location.needsFolder) group.folders.set(artifact.id, location.folder)
		group.count++
		groups.set(key, group)
	}
	return [...groups.values()]
}
