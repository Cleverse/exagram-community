import { clientIp } from "./client-ip"

import type { Env } from "../env"
import type { FastifyRequest, FastifyServerOptions } from "fastify"

/**
 * A Link token in a URL is the Link itself, an upload token is a write ticket, and a Join Link's or a
 * Reset Link's token previewed by path is a sign-up or a password: anyone holding a log line could use
 * any of them. The upload route takes everything after the prefix as the token.
 */
export const maskLinkToken = (url: string): string =>
	url
		.replace(/^\/l\/[^/?#]+/, "/l/[token]")
		.replace(/^\/v1\/uploads\/[^?#]+/, "/v1/uploads/[token]")
		.replace(/^(\/v1\/auth\/(?:invites|reset))\/[^/?#]+/, "$1/[token]")

/** The Mac client's sealed handoff code (ADR 0030) is half a sign-in; it stays out of the logs with the verifier. */
export const maskNativeRedeem = (url: string): string => url.replace(/^(\/v1\/auth\/native\/redeem)\?.*/, "$1?[code]")

/** Fastify's default request serializer, with Link and upload tokens and handoff codes masked out of `url`. */
const serializeRequest = (request: FastifyRequest, clientIpHeader: string | null) => ({
	method: request.method,
	url: maskNativeRedeem(maskLinkToken(request.url)),
	version: request.headers["accept-version"] as string | undefined,
	host: request.host,
	remoteAddress: request.ip,
	clientIp: clientIp(request, clientIpHeader),
	remotePort: request.socket?.remotePort,
})

/** Mirrors `server.ts`'s logger config: `pino-pretty` is a dev-only transport. */
export const loggerOptions = (
	env: Pick<Env, "LOG_LEVEL" | "NODE_ENV" | "CLIENT_IP_HEADER">,
): FastifyServerOptions["logger"] => ({
	level: env.LOG_LEVEL,
	serializers: { req: (request: FastifyRequest) => serializeRequest(request, env.CLIENT_IP_HEADER) },
	...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
})
