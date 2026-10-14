import { type Project } from "@exagram/api-client"

export type Location = {
	/** The top-level Project, or null for a file in no Project (or one the reader cannot list). */
	project: Project | null
	/** The folder (sub-Project) inside it; "Unsorted" when the Project has folders and this file is in none. */
	folder: string | null
	/** A file sitting loose in a Project that has folders, which the design flags until it is filed. */
	needsFolder: boolean
	/** The file is in a Project the reader does not have in their list: someone else's, shared file by file. */
	elsewhere: boolean
}

/** Where a file sits in the Project › folder tree, from the flat Project list. */
export const locationOf = (projectId: string | null, projects: Project[]): Location => {
	const byId = new Map(projects.map((project) => [project.id, project]))
	const here = projectId === null ? undefined : byId.get(projectId)
	if (here === undefined) return { project: null, folder: null, needsFolder: false, elsewhere: projectId !== null }
	const parent = here.parentProjectId === null ? undefined : byId.get(here.parentProjectId)
	if (parent !== undefined) return { project: parent, folder: here.name, needsFolder: false, elsewhere: false }
	const hasFolders = projects.some((candidate) => candidate.parentProjectId === here.id)
	return { project: here, folder: hasFolders ? "Unsorted" : null, needsFolder: hasFolders, elsewhere: false }
}

/** "Q4 › Pricing", "Q4 › Unsorted", "Q4", "Shared with you" or "No folder". */
export const locationLabel = (location: Location) =>
	location.project === null
		? location.elsewhere
			? "Shared with you"
			: "No folder"
		: location.folder === null
			? location.project.name
			: `${location.project.name} › ${location.folder}`
