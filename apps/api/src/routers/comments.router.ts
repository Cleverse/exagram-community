import { commentsContract } from "@exagram/core/contract/comments/contract"
import { implement } from "@orpc/server"

import { type AuthContext, type BaseContext } from "../plugins/context"
import { refusalMiddleware } from "../plugins/refusal.middleware"
import { requireUser } from "../plugins/require-user.middleware"
import { unlockHashOf } from "../plugins/unlock-cookie"
import { type CommentsUsecase } from "../usecase/comments.usecase"

interface CommentsRouterParams {
	commentsUsecase: CommentsUsecase
}

export const createCommentsRouter = ({ commentsUsecase }: CommentsRouterParams) => {
	const os = implement(commentsContract).$context<BaseContext>()
	const baseAuth = os.$context<AuthContext>()
	return os
		.use(refusalMiddleware)
		.use(requireUser)
		.router({
			list: baseAuth.list.handler(async ({ context: { user, headers }, input }) => ({
				result: await commentsUsecase.list(user, input.query.artifactId, unlockHashOf(headers, input.query.artifactId)),
			})),
			create: baseAuth.create.handler(async ({ context: { user, headers }, input }) => ({
				result: await commentsUsecase.create(user, input.body.revisionId, input.body.body, (artifactId) =>
					unlockHashOf(headers, artifactId),
				),
			})),
		})
}
