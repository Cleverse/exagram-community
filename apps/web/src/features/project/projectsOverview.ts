import { type VisibleArtifact, type VisibleProject } from "@exagram/api-client"

import { rootProjects, summarizeProjects } from "@/features/library/projectSummary"

/** One row of the Projects screen: a top-level Project with its subfolders folded in. */
export type ProjectOverviewRow = {
	project: VisibleProject
	files: number
	access: string
	/** The newest file update in it or its subfolders, or when it was made if it holds none. */
	lastActivity: Date
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * Who reaches the Project, in a few words. `memberNames` is null for a Viewer, who sees the Owner only; a Project
 * the reader owns with no members can still hold files shared on their own.
 */
const accessOf = (project: VisibleProject, meId: string | undefined, anyFileShared: boolean): string => {
	if (project.ownerId !== meId) return `Shared by ${project.ownerName}`
	const members = project.memberNames ?? []
	if (members.length === 1) return `Shared with ${members[0]}`
	if (members.length > 1) return `Shared with ${plural(members.length, "person", "people")}`
	return anyFileShared ? "Some files shared" : "Not shared"
}

/**
 * The Projects screen's rows, newest activity first. Like the sidebar it lists top-level Projects only and counts
 * from the whole readable library, so the two never disagree.
 */
export const projectsOverview = (
	projects: VisibleProject[],
	artifacts: VisibleArtifact[],
	meId: string | undefined,
): ProjectOverviewRow[] => {
	const { countFor } = summarizeProjects(projects, artifacts, meId)
	const newest = new Map<string, number>()
	const fileShared = new Set<string>()
	for (const artifact of artifacts) {
		if (artifact.projectId === null) continue
		const at = new Date(artifact.updatedAt).getTime()
		newest.set(artifact.projectId, Math.max(newest.get(artifact.projectId) ?? 0, at))
		if (artifact.sharedWithNames.length > 0) fileShared.add(artifact.projectId)
	}

	return rootProjects(projects)
		.map((project) => {
			const ids = [project.id, ...projects.filter((child) => child.parentProjectId === project.id).map((c) => c.id)]
			const latest = Math.max(new Date(project.createdAt).getTime(), ...ids.map((id) => newest.get(id) ?? 0))
			return {
				project,
				files: countFor(project.id),
				access: accessOf(
					project,
					meId,
					ids.some((id) => fileShared.has(id)),
				),
				lastActivity: new Date(latest),
			}
		})
		.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime())
}
