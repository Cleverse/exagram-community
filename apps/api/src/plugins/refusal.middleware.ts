import { MemberRemovedError, REFUSAL_TEXT, RefusalError } from "@exagram/core/utils/refusal"
import { ORPCError, os } from "@orpc/server"

/** Every refusal leaves the API as the same status and the same sentence. */
export const refusalMiddleware = os.middleware(async ({ next }) => {
	try {
		return await next({})
	} catch (error) {
		if (error instanceof RefusalError || error instanceof MemberRemovedError)
			throw new ORPCError("NOT_FOUND", { message: REFUSAL_TEXT })
		throw error
	}
})
