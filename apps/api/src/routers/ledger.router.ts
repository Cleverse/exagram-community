import { ledgerContract } from "@exagram/core/contract/ledger/contract"
import { implement } from "@orpc/server"

import { type AuthContext, type BaseContext } from "../plugins/context"
import { refusalMiddleware } from "../plugins/refusal.middleware"
import { requireUser } from "../plugins/require-user.middleware"
import { type LedgerUsecase } from "../usecase/ledger.usecase"

interface LedgerRouterParams {
	ledgerUsecase: LedgerUsecase
}

export const createLedgerRouter = ({ ledgerUsecase }: LedgerRouterParams) => {
	const os = implement(ledgerContract).$context<BaseContext>()
	const baseAuth = os.$context<AuthContext>()
	return os
		.use(refusalMiddleware)
		.use(requireUser)
		.router({
			forArtifact: baseAuth.forArtifact.handler(async ({ context: { user }, input }) => ({
				result: await ledgerUsecase.forArtifact(user.id, input.params.artifactId, input.query),
			})),
			viewers: baseAuth.viewers.handler(async ({ context: { user }, input }) => ({
				result: { items: await ledgerUsecase.viewers(user.id, input.params.artifactId) },
			})),
			activity: baseAuth.activity.handler(async ({ context: { user }, input }) => ({
				result: await ledgerUsecase.activity(user, input.query),
			})),
		})
}
