import { BadRequestError, ConflictError, NotFoundError } from "@exagram/core/utils/errors"

import type { ProjectsDatagateway } from "@exagram/core/datagateway/projects.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { PublishPolicy } from "@exagram/core/entity/artifact"
import type { User } from "@exagram/core/entity/auth"
import type { LinkPreview, Project, VisibleProject } from "@exagram/core/entity/project"

const PROJECT_NOT_FOUND = "Project not found."
const TOO_DEEP = "A project can be one level deep."

const isUniqueViolation = (error: unknown): boolean =>
	typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"

export class ProjectsUsecase {
	constructor(
		private readonly projects: ProjectsDatagateway,
		private readonly tx: TransactionManager,
	) {}

	/** The user's own Projects and the ones shared with them, so a shared Project shows in their sidebar. */
	list(user: User): Promise<VisibleProject[]> {
		return this.projects.listVisible(user.id, user.workspaceId)
	}

	async create(user: User, input: { name: string; parentProjectId: string | null }): Promise<Project> {
		return this.tx.atomic(async () => {
			const parent = input.parentProjectId ? await this.requireRootOwnedBy(user, input.parentProjectId) : null
			try {
				return await this.projects.create({
					workspaceId: parent?.workspaceId ?? user.workspaceId,
					ownerId: user.id,
					parentProjectId: input.parentProjectId,
					name: input.name,
				})
			} catch (error) {
				if (isUniqueViolation(error)) throw new ConflictError("A project with that name already exists here.")
				throw error
			}
		})
	}

	async rename(user: User, input: { projectId: string; name: string }): Promise<Project> {
		try {
			const renamed = await this.projects.rename(input.projectId, user.id, input.name)
			if (!renamed) throw new NotFoundError(PROJECT_NOT_FOUND)
			return renamed
		} catch (error) {
			if (isUniqueViolation(error)) throw new ConflictError("A project with that name already exists here.")
			throw error
		}
	}

	async move(user: User, input: { projectId: string; parentProjectId: string | null }): Promise<Project> {
		return this.tx.atomic(async () => {
			const project = await this.projects.getById(input.projectId)
			if (!project || project.ownerId !== user.id) throw new NotFoundError(PROJECT_NOT_FOUND)
			if (input.parentProjectId !== null) {
				if (input.parentProjectId === project.id) throw new BadRequestError("A project cannot sit inside itself.")
				const parent = await this.requireRootOwnedBy(user, input.parentProjectId)
				if (parent.workspaceId !== project.workspaceId) throw new NotFoundError(PROJECT_NOT_FOUND)
				const contents = await this.projects.countContents(project.id)
				if (contents.childCount > 0) throw new BadRequestError(TOO_DEEP)
			}
			const moved = await this.projects.move(input.projectId, user.id, input.parentProjectId)
			if (!moved) throw new NotFoundError(PROJECT_NOT_FOUND)
			return moved
		})
	}

	/** Only the Owner decides whether uploads here publish themselves or wait for approval. */
	async setPublishPolicy(user: User, input: { projectId: string; publishPolicy: PublishPolicy }): Promise<Project> {
		const updated = await this.projects.setPublishPolicy(input.projectId, user.id, input.publishPolicy)
		if (!updated) throw new NotFoundError(PROJECT_NOT_FOUND)
		return updated
	}

	/** Only the Owner decides whether link previews of this Project and its files show titles (ADR 0019). */
	async setLinkPreview(user: User, input: { projectId: string; linkPreview: LinkPreview }): Promise<Project> {
		const updated = await this.projects.setLinkPreview(input.projectId, user.id, input.linkPreview)
		if (!updated) throw new NotFoundError(PROJECT_NOT_FOUND)
		return updated
	}

	async delete(user: User, projectId: string): Promise<{ id: string }> {
		return this.tx.atomic(async () => {
			const project = await this.projects.getById(projectId)
			if (!project || project.ownerId !== user.id) throw new NotFoundError(PROJECT_NOT_FOUND)
			const contents = await this.projects.countContents(projectId)
			if (contents.artifactCount > 0 || contents.childCount > 0) throw new ConflictError("Project is not empty.")
			if (!(await this.projects.deleteOwned(projectId, user.id))) throw new NotFoundError(PROJECT_NOT_FOUND)
			return { id: projectId }
		})
	}

	/** A parent must be owned by the caller and must itself be a root: depth stays at one. */
	private async requireRootOwnedBy(user: User, parentProjectId: string): Promise<Project> {
		const parent = await this.projects.getById(parentProjectId)
		if (!parent || parent.ownerId !== user.id) throw new NotFoundError(PROJECT_NOT_FOUND)
		if (parent.parentProjectId !== null) throw new BadRequestError(TOO_DEEP)
		return parent
	}
}
