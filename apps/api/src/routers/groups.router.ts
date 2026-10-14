import { groupsContract } from "@exagram/core/contract/groups/contract"
import { implement } from "@orpc/server"

import { requireUser } from "../plugins/require-user.middleware"

import type { AuthContext, BaseContext } from "../plugins/context"
import type { GroupsUsecase } from "../usecase/groups.usecase"

export const createGroupsRouter = ({ groupsUsecase }: { groupsUsecase: GroupsUsecase }) => {
	const os = implement(groupsContract).$context<BaseContext>()
	const authed = os.$context<AuthContext>()

	return os.use(requireUser).router({
		list: authed.list.handler(async ({ context }) => ({
			result: await groupsUsecase.list(context.user),
		})),
		create: authed.create.handler(async ({ context, input }) => ({
			result: await groupsUsecase.create(context.user, input.body),
		})),
		update: authed.update.handler(async ({ context, input }) => ({
			result: await groupsUsecase.update(context.user, input.params.id, input.body),
		})),
		delete: authed.delete.handler(async ({ context, input }) => ({
			result: await groupsUsecase.delete(context.user, input.params.id),
		})),
	})
}
