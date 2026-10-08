import { ORPCError } from "@orpc/server"

import type { FastifyInstance } from "fastify"
import type { IncomingHttpHeaders } from "node:http"

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * Web and api may be sibling hosts of one registrable domain, so SameSite=Lax still sends the
 * session cookie from every sibling subdomain. Origin is the control; requests with neither header
 * (non-browser clients) are allowed.
 */
export const isTrustedOrigin = (headers: IncomingHttpHeaders, allowedOrigin: string): boolean => {
	const origin = headers.origin
	if (typeof origin === "string" && origin !== allowedOrigin) return false
	const secFetchSite = headers["sec-fetch-site"]
	if (secFetchSite === "cross-site") return false
	return true
}

export const checkSameOrigin = (headers: IncomingHttpHeaders, allowedOrigin: string): void => {
	if (!isTrustedOrigin(headers, allowedOrigin)) {
		throw new ORPCError("FORBIDDEN", { message: "Cross-origin request refused." })
	}
}

export interface OriginGuardParams {
	prefix: string
	allowedOrigin: string
	/** Exact paths (query aside) that take POSTs from other origins on purpose, authorized otherwise. POST only. */
	exemptPostPaths?: readonly string[]
}

/** `/mcp` is bearer-authenticated and deliberately exempt, as are `/oauth/*` and `/l/*`. */
export const registerOriginGuard = (
	app: FastifyInstance,
	{ prefix, allowedOrigin, exemptPostPaths = [] }: OriginGuardParams,
): void => {
	app.addHook("onRequest", (request, reply, done) => {
		if (request.url !== prefix && !request.url.startsWith(`${prefix}/`) && !request.url.startsWith(`${prefix}?`)) {
			return done()
		}
		if (!STATE_CHANGING_METHODS.has(request.method)) return done()
		if (request.method === "POST" && exemptPostPaths.includes(request.url.split("?", 1)[0] ?? "")) return done()
		if (isTrustedOrigin(request.headers, allowedOrigin)) return done()
		void reply.code(403).send({ code: "FORBIDDEN" })
	})
}
