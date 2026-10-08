import { projectsContract } from "@exagram/core/contract/projects/contract"
import { implement } from "@orpc/server"

import { requireUser } from "../plugins/require-user.middleware"

import type { AuthContext, BaseContext } from "../plugins/context"
import type { ProjectsUsecase } from "../usecase/projects/projects.usecase"

export const createProjectsRouter = ({ projectsUsecase }: { projectsUsecase: ProjectsUsecase }) => {
	const os = implement(projectsContract).$context<BaseContext>()
	const authed = os.$context<AuthContext>()

	return os.use(requireUser).router({
		list: authed.list.handler(async ({ context }) => ({
			result: { items: await projectsUsecase.list(context.user) },
		})),
		create: authed.create.handler(async ({ context, input }) => ({
			result: await projectsUsecase.create(context.user, input.body),
		})),
		rename: authed.rename.handler(async ({ context, input }) => ({
			result: await projectsUsecase.rename(context.user, { projectId: input.params.id, name: input.body.name }),
		})),
		move: authed.move.handler(async ({ context, input }) => ({
			result: await projectsUsecase.move(context.user, {
				projectId: input.params.id,
				parentProjectId: input.body.parentProjectId,
			}),
		})),
		setPublishPolicy: authed.setPublishPolicy.handler(async ({ context, input }) => ({
			result: await projectsUsecase.setPublishPolicy(context.user, {
				projectId: input.params.id,
				publishPolicy: input.body.publishPolicy,
			}),
		})),
		setLinkPreview: authed.setLinkPreview.handler(async ({ context, input }) => ({
			result: await projectsUsecase.setLinkPreview(context.user, {
				projectId: input.params.id,
				linkPreview: input.body.linkPreview,
			}),
		})),
		delete: authed.delete.handler(async ({ context, input }) => ({
			result: await projectsUsecase.delete(context.user, input.params.id),
		})),
	})
}
