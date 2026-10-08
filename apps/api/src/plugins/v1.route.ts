import type { BaseContext } from "./context"
import type { OpenAPIHandler } from "@orpc/openapi/fastify"
import type { FastifyReply, FastifyRequest } from "fastify"

/**
 * The human API's catch-all route. Every answer is for one caller at one moment, and a gate's 403 or 410
 * stops being true once the Owner changes the setting (ADR 0044). Browsers cache a 410 on their own when no
 * header forbids it, so nothing under /v1 may be reused.
 */
export const v1Route =
	(handler: OpenAPIHandler<BaseContext>, ipOf: (request: FastifyRequest) => string) =>
	async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
		reply.header("cache-control", "no-store")
		const { matched } = await handler.handle(request, reply, {
			prefix: "/v1",
			context: { headers: request.headers, ip: ipOf(request), requestId: request.id, user: request.user ?? null },
		})
		if (!matched) reply.status(404).send({ code: "NOT_FOUND", message: "Not found" })
	}
