import { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

import { apiOrigin } from "./oauth.env"

import type Provider from "oidc-provider"

const MOUNT = "/oauth"

/**
 * The provider owns its own HTTP framing, so these routes hijack the reply and hand the raw
 * handles over. The mount prefix is stripped because `provider.callback()` expects issuer-relative
 * paths, the way `app.use("/oauth", …)` would deliver them.
 */
export function registerOAuthMount(app: FastifyInstance, provider: Provider): void {
	const callback = provider.callback()

	const forward = (req: FastifyRequest, reply: FastifyReply, rawUrl: string, originalUrl?: string) => {
		reply.hijack()
		// Proxy headers are attacker-controlled and the chain in front of us doesn't reliably set
		// them, so pin them to the configured origin: discovery URLs must match the issuer.
		const origin = new URL(apiOrigin())
		req.raw.headers["x-forwarded-proto"] = origin.protocol.slice(0, -1)
		req.raw.headers["x-forwarded-host"] = origin.host
		// oidc-provider's urlFor() derives the mount path the way koa-mount does: from
		// `req.originalUrl` (the full incoming path) versus the now-stripped `req.url`. Without it,
		// every generated URL (discovery endpoints, redirects) loses the `/oauth` prefix. Callers that
		// don't front the request under `/oauth` (the RFC 8414 aliases below) supply their own.
		;(req.raw as unknown as { originalUrl?: string }).originalUrl ??= originalUrl ?? req.raw.url
		req.raw.url = rawUrl
		void callback(req.raw, reply.raw)
	}

	app.route({
		method: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
		url: `${MOUNT}/*`,
		handler: (req, reply) => forward(req, reply, req.raw.url!.slice(MOUNT.length) || "/"),
	})

	app.route({
		method: ["GET", "POST", "OPTIONS", "HEAD"],
		url: MOUNT,
		handler: (req, reply) => forward(req, reply, "/"),
	})

	// RFC 8414 §3.1 path insertion: a client reads authorization_servers from the RFC 9728 document
	// and looks for the metadata at the root, not under the issuer path. The incoming path here
	// doesn't carry the `/oauth` mount, so tell urlFor() the mounted equivalent directly.
	for (const alias of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/oauth"]) {
		app.get(alias, (req, reply) =>
			forward(req, reply, "/.well-known/openid-configuration", `${MOUNT}/.well-known/openid-configuration`),
		)
	}
}
