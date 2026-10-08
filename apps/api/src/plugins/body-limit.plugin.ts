import { Readable } from "node:stream"

import type { FastifyInstance, FastifyRequest } from "fastify"

const bodyTooLarge = (bodyLimit: number): Error & { statusCode: number } =>
	Object.assign(new Error(`A request body may be at most ${bodyLimit} bytes.`), { statusCode: 413 })

/**
 * `OpenAPIHandler` reads the request body straight off `request.raw`, bypassing Fastify's own
 * body-parsing machinery entirely (it never even looks at `request[kRequestPayloadStream]`) — so
 * Fastify's `bodyLimit` option, which only guards its own parsers, never sees these bytes. This
 * registers the catch-all content-type parser oRPC needs and enforces the limit itself: a
 * declared Content-Length over the limit is rejected outright, and a body with no declared
 * length (chunked) is measured as it streams and cut off past the limit. A body within the limit
 * is buffered here and handed back as a stream, so oRPC's own per-content-type parsing
 * downstream sees the same bytes it would have read from the live connection.
 */
export const registerBodyLimitParser = (app: FastifyInstance, bodyLimit: number): void => {
	// "*" alone never runs for `application/json` or `text/plain`: Fastify has a built-in parser for
	// both, which takes precedence over "*", fully drains `request.raw` into `request.body` and
	// leaves nothing for a consumer reading the raw stream directly. Naming them here overrides the
	// built-ins too. `application/x-www-form-urlencoded` has no Fastify built-in, so "*" already
	// covers it — adding it here as well would collide with a route that registers its own scoped
	// override for that type (encapsulation inherits, and re-adding an inherited type throws).
	app.addContentTypeParser(["*", "application/json", "text/plain"], (request, payload, done) => {
		const requestLimit = request.routeOptions.bodyLimit ?? bodyLimit
		const declared = Number(request.headers["content-length"])
		if (Number.isFinite(declared) && declared > requestLimit) {
			payload.destroy()
			done(bodyTooLarge(requestLimit))
			return
		}

		const rawMethod = request.raw.method
		const rawUrl = request.raw.url
		const rawSocket = request.raw.socket
		// @hono/node-server (behind the MCP transport) reads `rawHeaders` itself rather than
		// `headers`, so the replacement stream below needs it too or it throws reading past the end
		// of an absent array.
		const rawHeaders = request.raw.rawHeaders
		const chunks: Buffer[] = []
		let received = 0
		let settled = false

		const fail = (error: Error): void => {
			if (settled) return
			settled = true
			payload.removeAllListeners("data")
			payload.removeAllListeners("end")
			payload.destroy()
			done(error)
		}

		payload.on("data", (chunk: Buffer) => {
			received += chunk.length
			if (received > requestLimit) {
				fail(bodyTooLarge(requestLimit))
				return
			}
			chunks.push(chunk)
		})
		payload.on("error", (error: Error) => fail(error))
		payload.on("end", () => {
			if (settled) return
			settled = true
			const buffered = Readable.from(chunks) as unknown as FastifyRequest["raw"]
			Object.assign(buffered, {
				headers: request.headers,
				rawHeaders,
				method: rawMethod,
				url: rawUrl,
				socket: rawSocket,
			})
			request.raw = buffered
			done(null, undefined)
		})
	})
}
