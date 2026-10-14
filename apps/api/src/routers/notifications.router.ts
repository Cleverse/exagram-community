import { notificationsContract } from "@exagram/core/contract/notifications/contract"
import { implement } from "@orpc/server"

import { type BaseContext } from "../plugins/context"
import { refusalMiddleware } from "../plugins/refusal.middleware"
import { requireUser } from "../plugins/require-user.middleware"
import { type NotificationsUsecase } from "../usecase/notifications.usecase"

interface NotificationsRouterParams {
	notificationsUsecase: NotificationsUsecase
}

export const createNotificationsRouter = (params: NotificationsRouterParams) => {
	const { notificationsUsecase } = params
	const os = implement(notificationsContract).$context<BaseContext>().use(refusalMiddleware)
	const baseAuth = os.use(requireUser)
	return os.router({
		list: baseAuth.list.handler(async ({ context: { user }, input }) => ({
			result: await notificationsUsecase.list(user, input.query),
		})),
		getPreferences: baseAuth.getPreferences.handler(async ({ context: { user } }) => ({
			result: await notificationsUsecase.getPreferences(user),
		})),
		setPreferences: baseAuth.setPreferences.handler(async ({ context: { user }, input }) => ({
			result: await notificationsUsecase.setPreferences(user, input.body),
		})),
	})
}
