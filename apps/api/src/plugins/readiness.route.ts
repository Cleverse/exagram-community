import type { FastifyInstance } from "fastify"

export const registerReadiness = (app: FastifyInstance, isReady: () => boolean): void => {
	app.all("/readiness", (_request, reply) => {
		if (!isReady()) return reply.code(503).type("text/plain").send("NOT READY")
		return reply.type("text/plain").send("OK")
	})
}
