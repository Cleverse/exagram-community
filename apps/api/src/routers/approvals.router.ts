import { approvalsContract } from "@exagram/core/contract/approvals/contract"
import { implement } from "@orpc/server"

import { requireUser } from "../plugins/require-user.middleware"

import type { AuthContext, BaseContext } from "../plugins/context"
import type { ApprovalsUsecase } from "../usecase/approvals/approvals.usecase"

export const createApprovalsRouter = ({ approvalsUsecase }: { approvalsUsecase: ApprovalsUsecase }) => {
	const os = implement(approvalsContract).$context<BaseContext>()
	const authed = os.$context<AuthContext>()

	return os.use(requireUser).router({
		listPending: authed.listPending.handler(async ({ context }) => ({
			result: { items: await approvalsUsecase.listPending(context.user) },
		})),
		approve: authed.approve.handler(async ({ context, input }) => ({
			result: await approvalsUsecase.approve(context.user, {
				revisionId: input.params.revisionId,
				confirmPlaceholders: input.body.confirmPlaceholders,
			}),
		})),
		discard: authed.discard.handler(async ({ context, input }) => ({
			result: await approvalsUsecase.discard(context.user, input.params.revisionId),
		})),
	})
}
