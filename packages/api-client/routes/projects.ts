import { type coreContract } from "@exagram/core/contract"

import { type LinkPreview, type Project, type PublishPolicy, type VisibleProject } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"
import { unwrapResult } from "../utils/result"

export class ProjectsRouter extends Router<typeof coreContract> {
	/** Projects the caller owns plus Projects a Grant reaches; the server decides which. */
	async list(): Promise<VisibleProject[]> {
		try {
			return unwrapResult(await this.client.projects.list({})).items
		} catch (error) {
			return failWith(error, "Could not load your Projects")
		}
	}

	async create(input: { name: string; parentProjectId: string | null }): Promise<Project> {
		try {
			return unwrapResult(await this.client.projects.create({ body: input }))
		} catch (error) {
			return failWith(error, "Could not create the Project")
		}
	}

	async rename(input: { projectId: string; name: string }): Promise<Project> {
		try {
			return unwrapResult(
				await this.client.projects.rename({ params: { id: input.projectId }, body: { name: input.name } }),
			)
		} catch (error) {
			return failWith(error, "Could not rename the Project")
		}
	}

	/** Owner only: whether uploads here publish on arrival ('auto') or wait for approval ('manual'). */
	async setPublishPolicy(input: { projectId: string; publishPolicy: PublishPolicy }): Promise<Project> {
		try {
			return unwrapResult(
				await this.client.projects.setPublishPolicy({
					params: { id: input.projectId },
					body: { publishPolicy: input.publishPolicy },
				}),
			)
		} catch (error) {
			return failWith(error, "Could not change the publishing policy")
		}
	}

	/** Owner only: whether link previews show this Project's titles ('metadata') or a generic card ('generic'). */
	async setLinkPreview(input: { projectId: string; linkPreview: LinkPreview }): Promise<Project> {
		try {
			return unwrapResult(
				await this.client.projects.setLinkPreview({
					params: { id: input.projectId },
					body: { linkPreview: input.linkPreview },
				}),
			)
		} catch (error) {
			return failWith(error, "Could not change link previews")
		}
	}

	async move(input: { projectId: string; parentProjectId: string | null }): Promise<Project> {
		try {
			return unwrapResult(
				await this.client.projects.move({
					params: { id: input.projectId },
					body: { parentProjectId: input.parentProjectId },
				}),
			)
		} catch (error) {
			return failWith(error, "Could not move the Project")
		}
	}

	/** The server refuses a Project that still holds Artifacts; the message says so. */
	async remove(input: { projectId: string }): Promise<{ id: string }> {
		try {
			return unwrapResult(await this.client.projects.delete({ params: { id: input.projectId } }))
		} catch (error) {
			return failWith(error, "Could not delete the Project — empty it first")
		}
	}
}
