import { type FastifyInstance } from "fastify"

import { PROTECTED_RESOURCE_PATH, protectedResourceMetadata } from "./challenge"

export function registerProtectedResourceMetadata(app: FastifyInstance): void {
	// Served at both spellings: clients differ on whether they insert the resource path.
	for (const path of [PROTECTED_RESOURCE_PATH, `${PROTECTED_RESOURCE_PATH}/mcp`]) {
		app.get(path, (_req, reply) => {
			reply
				.header("cache-control", "public, max-age=3600")
				.header("access-control-allow-origin", "*")
				.type("application/json")
				.send(protectedResourceMetadata())
		})
	}
}
