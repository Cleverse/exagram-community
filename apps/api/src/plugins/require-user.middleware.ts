import { ORPCError, os } from "@orpc/server"

import type { BaseContext } from "./context"

export const requireUser = os.$context<BaseContext>().middleware(async ({ context, next }) => {
	if (!context.user) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." })
	return next({ context: { user: context.user } })
})
