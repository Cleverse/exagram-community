import { connectionsContract } from "@exagram/core/contract/connections/contract"
import { implement } from "@orpc/server"

import { type AuthContext, type BaseContext } from "../plugins/context"
import { refusalMiddleware } from "../plugins/refusal.middleware"
import { requireUser } from "../plugins/require-user.middleware"
import { type ConnectionsUsecase } from "../usecase/connections.usecase"

interface ConnectionsRouterParams {
	connectionsUsecase: ConnectionsUsecase
}

export const createConnectionsRouter = ({ connectionsUsecase }: ConnectionsRouterParams) => {
	const base = implement(connectionsContract).$context<BaseContext>()
	const baseAuth = base.$context<AuthContext>()
	return base
		.use(refusalMiddleware)
		.use(requireUser)
		.router({
			list: baseAuth.list.handler(async ({ context: { user } }) => {
				return { result: { connections: await connectionsUsecase.list(user.id) } }
			}),
			revoke: baseAuth.revoke.handler(async ({ context: { user }, input: { params } }) => {
				return { result: await connectionsUsecase.revoke(user.id, params.connectionId) }
			}),
			folders: baseAuth.folders.handler(async ({ context: { user }, input: { params } }) => {
				return { result: await connectionsUsecase.folders(user.id, params.connectionId) }
			}),
			saveFolders: baseAuth.saveFolders.handler(async ({ context: { user }, input: { params, body } }) => {
				return { result: await connectionsUsecase.saveFolders(user.id, params.connectionId, body) }
			}),
		})
}
