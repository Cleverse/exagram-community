import { consentContract } from "@exagram/core/contract/consent/contract"
import { implement, os } from "@orpc/server"

import { type AuthContext, type BaseContext, type ConsentContext } from "../plugins/context"
import { checkSameOrigin } from "../plugins/origin-guard"
import { requireUser } from "../plugins/require-user.middleware"
import { type ConsentUsecase } from "../usecase/consent.usecase"

interface ConsentRouterParams {
	consentUsecase: ConsentUsecase
	webOrigin: string
}

export { checkSameOrigin }

const createSameOriginMiddleware = (webOrigin: string) =>
	os.$context<BaseContext>().middleware(async ({ context, next }) => {
		checkSameOrigin(context.headers, webOrigin)
		return next({})
	})

export const createConsentRouter = ({ consentUsecase, webOrigin }: ConsentRouterParams) => {
	const sameOriginMiddleware = createSameOriginMiddleware(webOrigin)
	const base = implement(consentContract).$context<ConsentContext>()
	const baseAuth = base.$context<ConsentContext & Pick<AuthContext, "user">>()

	// Signed in first: an interaction belongs to a person, and there is nothing to ask an anonymous one.
	return base.use(requireUser).router({
		info: baseAuth.info.handler(async ({ context, input: { params } }) => {
			return { result: await consentUsecase.info(context.raw, params.uid, context.user) }
		}),
		approve: baseAuth.use(sameOriginMiddleware).approve.handler(async ({ context, input: { body } }) => {
			return { result: await consentUsecase.approve(context.raw, context.user, body) }
		}),
		deny: baseAuth.use(sameOriginMiddleware).deny.handler(async ({ context }) => {
			return { result: await consentUsecase.deny(context.raw) }
		}),
	})
}
