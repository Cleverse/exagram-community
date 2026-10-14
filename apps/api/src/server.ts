import { randomUUID } from "node:crypto"

import { fastify, type FastifyInstance } from "fastify"

import { type Env } from "./env"

/** Fastify's built-in logger is pino; `pino-pretty` is a dev-only transport. */
export function buildServer(config: Env): FastifyInstance {
	const app = fastify({
		logger: {
			level: config.LOG_LEVEL,
			...(config.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
		},
		requestIdHeader: "x-request-id",
		genReqId: (request) => {
			const inbound = request.headers["x-request-id"]
			return typeof inbound === "string" && inbound.length > 0 ? inbound : randomUUID()
		},
	})

	app.addHook("onSend", (request, reply, payload, done) => {
		void reply.header("x-request-id", String(request.id))
		done(null, payload)
	})

	app.get("/healthz", () => ({ status: "ok" }))

	return app
}
