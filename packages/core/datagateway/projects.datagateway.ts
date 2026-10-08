import type { PublishPolicy } from "../entity/artifact"
import type { LinkPreview, NewProject, Project, VisibleProject } from "../entity/project"

export interface ProjectContents {
	artifactCount: number
	childCount: number
}

export interface ProjectsDatagateway {
	/** Throws MemberRemovedError when the owner is Removed, including by a removal it waited on. */
	create(input: NewProject): Promise<Project>
	listByOwner(ownerId: string): Promise<Project[]>
	/** The user's own Projects and every Project a Grant (on it or its parent) lets them reach. */
	listVisible(userId: string, workspaceId: string): Promise<VisibleProject[]>
	getById(id: string): Promise<Project | null>
	rename(id: string, ownerId: string, name: string): Promise<Project | null>
	move(id: string, ownerId: string, parentProjectId: string | null): Promise<Project | null>
	setPublishPolicy(id: string, ownerId: string, publishPolicy: PublishPolicy): Promise<Project | null>
	setLinkPreview(id: string, ownerId: string, linkPreview: LinkPreview): Promise<Project | null>
	deleteOwned(id: string, ownerId: string): Promise<boolean>
	countContents(id: string): Promise<ProjectContents>
}
