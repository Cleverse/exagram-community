import { accessRequestsContract } from "@exagram/core/contract/access-requests/contract"
import { RateLimitedError } from "@exagram/core/utils/errors"
import { implement } from "@orpc/server"

import { type RateCounter } from "../mcp/rate"
import { type AuthContext, type BaseContext } from "../plugins/context"
import { refusalMiddleware } from "../plugins/refusal.middleware"
import { requireUser } from "../plugins/require-user.middleware"
import { type AccessRequestsUsecase } from "../usecase/access-requests.usecase"

/**
 * Counts attempts, not kept requests: a budget spent only on kept rows would tell the caller which
 * Artifacts exist (ADR 0035).
 */
export const ACCESS_REQUESTS_PER_MINUTE = 10

interface AccessRequestsRouterParams {
	accessRequestsUsecase: AccessRequestsUsecase
	rate: RateCounter
}

export const createAccessRequestsRouter = ({ accessRequestsUsecase, rate }: AccessRequestsRouterParams) => {
	const os = implement(accessRequestsContract).$context<BaseContext>()
	const baseAuth = os.$context<AuthContext>()
	return os
		.use(refusalMiddleware)
		.use(requireUser)
		.router({
			create: baseAuth.create.handler(async ({ context: { user }, input }) => {
				if (!rate.take(user.id)) {
					throw new RateLimitedError(`Access requests are limited to ${rate.perMinute} per minute.`)
				}
				return { result: await accessRequestsUsecase.create(user.id, input.body) }
			}),
			// The same budget as asking, so cancel-and-ask cannot double it.
			cancel: baseAuth.cancel.handler(async ({ context: { user }, input }) => {
				if (!rate.take(user.id)) {
					throw new RateLimitedError(`Access requests are limited to ${rate.perMinute} per minute.`)
				}
				return { result: await accessRequestsUsecase.cancel(user.id, input.body) }
			}),
			list: baseAuth.list.handler(async ({ context: { user } }) => ({
				result: { items: await accessRequestsUsecase.list(user) },
			})),
			grant: baseAuth.grant.handler(async ({ context: { user }, input }) => ({
				result: await accessRequestsUsecase.grant(user.id, input.params.id, input.body.role),
			})),
			dismiss: baseAuth.dismiss.handler(async ({ context: { user }, input }) => ({
				result: { id: await accessRequestsUsecase.dismiss(user.id, input.params.id) },
			})),
		})
}
