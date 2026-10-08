import { type Project } from "@exagram/api-client"

/** A Project's place in the tree, top level first: "Sales › Q4" for a sub-Project, "Sales" for a top one. */
export const projectPath = (projectId: string, projects: Project[]): string => {
	const byId = new Map(projects.map((project) => [project.id, project]))
	const names: string[] = []
	const seen = new Set<string>()
	let at = byId.get(projectId)
	while (at && !seen.has(at.id)) {
		seen.add(at.id)
		names.unshift(at.name)
		at = at.parentProjectId === null ? undefined : byId.get(at.parentProjectId)
	}
	return names.join(" › ")
}

/** The toast after a move (v3.4 §1), shared by drag and drop and ⋯ › Move to: "Moved {file} to {project} › {subfolder}". */
export const movedMessage = (title: string, projectId: string | null, projects: Project[]) =>
	projectId === null ? `${title} is no longer in a project` : `Moved ${title} to ${projectPath(projectId, projects)}`
