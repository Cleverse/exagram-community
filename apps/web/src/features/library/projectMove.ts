import { type Project } from "@exagram/api-client"

/**
 * Whether a Project may move under `parentId` (`null`: to the top level). The server keeps the rules
 * (`projects.move`): only the Owner moves a Project, only into a top-level Project they own, and one level of
 * sub-Project deep, so a Project with folders of its own never gets a parent. The web mirrors them so a drag
 * lights only where a drop would land.
 */
export const canMoveProject = (
	projects: Project[],
	moving: Project,
	parentId: string | null,
	meId: string | undefined,
): boolean => {
	if (meId === undefined || moving.ownerId !== meId) return false
	if (parentId === moving.parentProjectId) return false
	if (parentId === null) return true
	if (parentId === moving.id) return false
	const parent = projects.find((candidate) => candidate.id === parentId)
	if (!parent || parent.ownerId !== meId || parent.parentProjectId !== null) return false
	return !projects.some((candidate) => candidate.parentProjectId === moving.id)
}

/** The toast after a Project moves: "Moved Q4 into Sales", or "Q4 is now a top-level project". */
export const projectMovedMessage = (name: string, parentId: string | null, projects: Project[]) => {
	if (parentId === null) return `${name} is now a top-level folder`
	const parent = projects.find((candidate) => candidate.id === parentId)
	return `Moved ${name} into ${parent?.name ?? "the folder"}`
}
