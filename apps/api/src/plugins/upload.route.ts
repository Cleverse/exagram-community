import { PassThrough } from "node:stream"

import {
	InvalidStorageKeyError,
	ObjectExistsError,
	UploadIdleTimeoutError,
	UploadSizeMismatchError,
} from "@exagram/core/services/storage/filesystem.object-store"

import type { UploadTokenPayload, UploadTokenSigner } from "@exagram/core/services/storage/filesystem.upload-token"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Readable } from "node:stream"

export interface UploadWriter {
	writeUpload(key: string, source: Readable, expected: { mime: string; bytes: number }): Promise<void>
}

export interface UploadRouteParams {
	store: UploadWriter
	tokens: Pick<UploadTokenSigner, "verify">
	now?: () => number
}

// The body must be in by the ticket's expiry, plus this: the store's idle timeout alone lets a
// client drip one byte at a time and hold the connection and its temp file indefinitely.
const DEADLINE_GRACE_MS = 5_000

class UploadDeadlineError extends Error {
	constructor() {
		super("upload did not finish before its ticket expired")
		this.name = "UploadDeadlineError"
	}
}

// The body names no reason: whoever holds a bad token learns nothing about why.
const refuse = (reply: FastifyReply, status: number, code: string): FastifyReply =>
	// The body may be unread or half read; closing stops Node from draining the rest of it.
	reply.code(status).header("connection", "close").send({ code })

/**
 * `PUT /v1/uploads/:token`, the filesystem driver's stand-in for a presigned URL. The token is the
 * whole authorisation: it signs the key, the exact size, the mime and the expiry. It is a URL
 * secret, so this route logs nothing that carries the URL.
 */
export const registerUploadRoute = (
	app: FastifyInstance,
	{ store, tokens, now = Date.now }: UploadRouteParams,
): void => {
	const tickets = new WeakMap<FastifyRequest, UploadTokenPayload>()

	void app.register((scope, _options, done) => {
		// The inherited parsers buffer the body (body-limit.plugin.ts); this one leaves `request.raw`
		// unread so the handler can stream it to disk.
		scope.removeAllContentTypeParsers()
		scope.addContentTypeParser("*", (_request, _payload, done) => done(null))

		scope.route({
			method: "PUT",
			// A wildcard, not `:token`: a token is longer than Fastify's 100-character param limit.
			url: "/v1/uploads/*",
			// Fastify's info-level request lines carry the URL, and with it the token.
			logLevel: "warn",
			// Checked before any body is read, so a refusal never touches the upload.
			onRequest: async (request, reply) => {
				const token = (request.params as { "*": string })["*"]
				const ticket = token.includes("/") ? null : tokens.verify(token, now())
				if (ticket === null) return refuse(reply, 403, "FORBIDDEN")
				if (request.headers["content-type"] !== ticket.mime) return refuse(reply, 400, "BAD_REQUEST")
				const declared = Number(request.headers["content-length"])
				if (Number.isFinite(declared) && declared > ticket.bytes) return refuse(reply, 413, "PAYLOAD_TOO_LARGE")
				tickets.set(request, ticket)
			},
			handler: async (request, reply) => {
				const ticket = tickets.get(request)
				if (ticket === undefined) return refuse(reply, 403, "FORBIDDEN")
				// `writeUpload` never destroys its source, so the deadline acts on a relay: erroring it fails the
				// write while `request.raw` stays open for the answer.
				const relay = new PassThrough()
				request.raw.pipe(relay)
				// Errors reach the write through its own listener; this only keeps a late one from being unhandled.
				relay.on("error", () => {})
				const deadline = setTimeout(
					() => relay.destroy(new UploadDeadlineError()),
					ticket.expiresAt + DEADLINE_GRACE_MS - now(),
				)
				try {
					await store.writeUpload(ticket.storageKey, relay, { mime: ticket.mime, bytes: ticket.bytes })
				} catch (error) {
					if (error instanceof UploadSizeMismatchError || error instanceof InvalidStorageKeyError) {
						return refuse(reply, 400, "BAD_REQUEST")
					}
					if (error instanceof ObjectExistsError) return refuse(reply, 409, "CONFLICT")
					if (error instanceof UploadIdleTimeoutError || error instanceof UploadDeadlineError) {
						if (request.raw.socket && !request.raw.socket.destroyed) return refuse(reply, 408, "REQUEST_TIMEOUT")
						// The client is gone; there is nobody to answer.
						reply.hijack()
						request.raw.destroy()
						return
					}
					// Answered here rather than thrown: Fastify's own 5xx log line would include the URL.
					request.log.error({ err: error }, "upload write failed")
					return refuse(reply, 500, "INTERNAL_SERVER_ERROR")
				} finally {
					clearTimeout(deadline)
					request.raw.unpipe(relay)
				}
				return reply.code(200).send()
			},
		})
		done()
	})
}
