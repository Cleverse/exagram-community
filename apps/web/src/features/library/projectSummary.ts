import { type Project, type VisibleArtifact, type VisibleProject } from "@exagram/api-client"

/**
 * The top-level rows of a Project list. A Grant on a child alone reaches the child without its parent, so a
 * Project whose parent is not in the list is a root too.
 */
export const rootProjects = <P extends Project>(projects: P[]): P[] => {
	const ids = new Set(projects.map((project) => project.id))
	return projects.filter((project) => project.parentProjectId === null || !ids.has(project.parentProjectId))
}

/**
 * Whether a file may be uploaded or moved into this folder: `null` (no Project) or a Project you own. The server
 * refuses the rest, so the web does not offer them; an id missing from the list is left to the server.
 */
export const canAddTo = (projects: Project[], projectId: string | null, meId: string | undefined) => {
	if (projectId === null) return true
	const project = projects.find((candidate) => candidate.id === projectId)
	return project === undefined || project.ownerId === meId
}

export const ONLY_OWNER_ADDS = "Only the folder's owner can add files to it."

/** Someone else's Project, or one of yours that anyone else reaches: the sidebar's SHARED FOLDERS. */
export const isSharedProject = (
	project: Project & Partial<Pick<VisibleProject, "memberNames">>,
	meId: string | undefined,
) => project.ownerId !== meId || (project.memberNames?.length ?? 0) > 0

/**
 * What a Project row shows beside its name, from the whole readable library: its file count and whether it is
 * shared. The desktop sidebar and the mobile lists both read it, so the two never disagree.
 */
export const summarizeProjects = (
	projects: VisibleProject[],
	artifacts: VisibleArtifact[],
	meId: string | undefined,
) => {
	const directCount = new Map<string, number>()
	const anyShared = new Set<string>()
	for (const artifact of artifacts) {
		if (artifact.projectId === null) continue
		directCount.set(artifact.projectId, (directCount.get(artifact.projectId) ?? 0) + 1)
		if (artifact.sharedWithNames.length > 0) anyShared.add(artifact.projectId)
	}

	return {
		/** The prototype's count folds a folder's subfolders into it, so a nested Project counts here too. */
		countFor: (projectId: string) =>
			(directCount.get(projectId) ?? 0) +
			projects
				.filter((child) => child.parentProjectId === projectId)
				.reduce((total, child) => total + (directCount.get(child.id) ?? 0), 0),
		/** Shared when someone else owns it or reaches it, or any file in it has its own Grant. */
		isShared: (project: Project & Partial<Pick<VisibleProject, "memberNames">>) =>
			isSharedProject(project, meId) || anyShared.has(project.id),
	}
}
