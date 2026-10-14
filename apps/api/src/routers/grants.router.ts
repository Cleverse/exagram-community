import { grantsContract } from "@exagram/core/contract/grants/contract"
import { implement } from "@orpc/server"

import { type AuthContext, type BaseContext } from "../plugins/context"
import { refusalMiddleware } from "../plugins/refusal.middleware"
import { requireUser } from "../plugins/require-user.middleware"
import { unlockHashOf } from "../plugins/unlock-cookie"
import { type GrantsUsecase } from "../usecase/grants.usecase"

import { grantView } from "./grant-view"

interface GrantsRouterParams {
	grantsUsecase: GrantsUsecase
}

export const createGrantsRouter = ({ grantsUsecase }: GrantsRouterParams) => {
	const os = implement(grantsContract).$context<BaseContext>()
	const baseAuth = os.$context<AuthContext>()
	return os
		.use(refusalMiddleware)
		.use(requireUser)
		.router({
			list: baseAuth.list.handler(async ({ context: { user }, input }) => ({
				result: { items: (await grantsUsecase.list(user.id, input.query)).map(grantView) },
			})),
			access: baseAuth.access.handler(async ({ context: { user, headers }, input }) => ({
				result: {
					access: await grantsUsecase.access(
						user.id,
						input.query,
						input.query.artifactId === undefined ? undefined : unlockHashOf(headers, input.query.artifactId),
					),
				},
			})),
			suggestions: baseAuth.suggestions.handler(async ({ context: { user }, input }) => {
				const target = {
					artifactId: input.query.artifactId,
					projectId: input.query.projectId,
					query: input.query.q,
					limit: input.query.limit,
				}
				return {
					result: {
						items: await grantsUsecase.suggestions(user.id, target),
						groups: await grantsUsecase.groupSuggestions(user.id, target),
					},
				}
			}),
			create: baseAuth.create.handler(async ({ context: { user }, input }) => {
				const { granteeEmail, groupId, ...target } = input.body
				const grantee = groupId !== undefined ? { groupId } : { granteeEmail: granteeEmail as string }
				return { result: grantView(await grantsUsecase.create(user.id, { ...target, ...grantee })) }
			}),
			updateRole: baseAuth.updateRole.handler(async ({ context: { user }, input }) => ({
				result: grantView(await grantsUsecase.updateRole(user.id, input.params.id, input.body.role)),
			})),
			updatePin: baseAuth.updatePin.handler(async ({ context: { user }, input }) => ({
				result: grantView(await grantsUsecase.updatePin(user.id, input.params.id, input.body.pinnedRevisionId)),
			})),
			remove: baseAuth.remove.handler(async ({ context: { user }, input }) => ({
				result: { id: await grantsUsecase.remove(user.id, input.params.id) },
			})),
			setDefaultPin: baseAuth.setDefaultPin.handler(async ({ context: { user }, input }) => ({
				result: await grantsUsecase.setDefaultPin(user.id, input.params.artifactId, input.body.defaultPin),
			})),
		})
}
