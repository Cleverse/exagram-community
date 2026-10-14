import type { RequestHeadersPluginContext, ResponseHeadersPluginContext } from "@orpc/server/plugins"
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http"

/** Structural on purpose: the auth entity is assignable to this without this module importing it. */
export interface SessionUser {
	id: string
	sessionId: string
	workspaceId: string
	email: string
	name: string
	isAdmin: boolean
	googleLinked: boolean
	createdAt: Date
}

declare module "fastify" {
	interface FastifyRequest {
		user: SessionUser | null
	}
}

export interface BaseContext extends RequestHeadersPluginContext, ResponseHeadersPluginContext {
	headers: IncomingHttpHeaders
	ip: string
	requestId: string
	user: SessionUser | null
}

export interface AuthContext extends BaseContext {
	user: SessionUser
}

/**
 * Extends `BaseContext`, not `AuthContext`: `user` stays nullable here so `requireUser` is still the
 * one thing that narrows it, the same as every other router. Declaring it non-null up front would
 * make the mount point require an already-signed-in user before the middleware ever runs.
 */
export interface ConsentContext extends BaseContext {
	raw: { req: IncomingMessage; res: ServerResponse }
	log: { warn(fields: object, message: string): void }
}
