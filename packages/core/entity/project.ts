import type { PublishPolicy } from "./artifact"

/** What an unfurler sees for this Project and its files: title and kind, or the generic page. */
export type LinkPreview = "metadata" | "generic"

export interface Project {
	id: string
	workspaceId: string
	ownerId: string
	parentProjectId: string | null
	name: string
	/** A child Project keeps its own value; it does not inherit its parent's. */
	publishPolicy: PublishPolicy
	/** A child Project keeps its own value here too. */
	linkPreview: LinkPreview
	sourceDescription?: string | null
	createdAt: Date
}

/**
 * A Project as the list shows it: who owns it, and everyone else who reaches it (its or its parent's Grants).
 * `memberNames` is null for a Viewer, who may not read who else is on it (the same rule as `grants.list`).
 */
export interface VisibleProject extends Project {
	ownerName: string
	memberNames: string[] | null
}

export interface NewProject {
	workspaceId: string
	ownerId: string
	parentProjectId: string | null
	name: string
}
