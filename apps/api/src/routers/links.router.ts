import { linksContract } from "@exagram/core/contract/links/contract"
import { implement } from "@orpc/server"

import { type AuthContext, type BaseContext } from "../plugins/context"
import { refusalMiddleware } from "../plugins/refusal.middleware"
import { requireUser } from "../plugins/require-user.middleware"
import { type LinksUsecase } from "../usecase/links.usecase"

interface LinksRouterParams {
	linksUsecase: LinksUsecase
}

export const createLinksRouter = ({ linksUsecase }: LinksRouterParams) => {
	const os = implement(linksContract).$context<BaseContext>()
	const baseAuth = os.$context<AuthContext>()
	return os
		.use(refusalMiddleware)
		.use(requireUser)
		.router({
			create: baseAuth.create.handler(async ({ context: { user }, input }) => ({
				result: await linksUsecase.create(user.id, input.body),
			})),
			list: baseAuth.list.handler(async ({ context: { user }, input }) => ({
				result: { items: await linksUsecase.list(user.id, input.query.artifactId) },
			})),
			revoke: baseAuth.revoke.handler(async ({ context: { user }, input }) => ({
				result: { id: await linksUsecase.revoke(user.id, input.params.id) },
			})),
		})
}
