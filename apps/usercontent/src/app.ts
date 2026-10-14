import { createHash } from "node:crypto"

import { ALLOWED_MIME_TYPES } from "@exagram/core/entity/artifact"
import {
	getRevisionBodyRef,
	insertUsercontentServe,
} from "@exagram/core/repository/postgres/gen/exagram_usercontent_sql"
import { verifyUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { fastify, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

import type { ObjectStore } from "@exagram/core/services/object-store.service"

import { canonicalCdnUrl, createCdnProxy } from "./cdn-proxy"
import { rewriteCdnUrls } from "./cdn-rewrite"
import { injectInlineShims } from "./inline-shims"
import { buildPdfViewerHtml } from "./pdf-viewer"

import type { Sql } from "postgres"

/**
 * Scripts run; the network is denied. With a usercontent origin, the same-origin /uc/cdn/ proxy path is the one
 * place scripts, styles, images and fonts load from.
 */
const buildCsp = (frameAncestors: string[], usercontentOrigin?: string): string => {
	const cdn = usercontentOrigin === undefined ? "" : ` ${usercontentOrigin}/uc/cdn/`
	return [
		"default-src 'none'",
		`script-src 'unsafe-inline' 'unsafe-eval' blob:${cdn}`,
		`style-src 'unsafe-inline'${cdn}`,
		`img-src data: blob:${cdn}`,
		`font-src data:${cdn}`,
		"media-src data: blob:",
		"frame-src blob:",
		"worker-src 'none'",
		"connect-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		`frame-ancestors ${frameAncestors.join(" ")}`,
		"webrtc 'block'",
		"sandbox allow-scripts",
	].join("; ")
}

const buildImageCsp = (mime: string, frameAncestors: string[]): string | null => {
	if (!ALLOWED_MIME_TYPES.image.has(mime)) return null
	return [
		"default-src 'none'",
		"script-src 'none'",
		"style-src 'none'",
		"img-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		`frame-ancestors ${frameAncestors.join(" ")}`,
		"sandbox",
	].join("; ")
}

const buildTextCsp = (frameAncestors: string[]): string =>
	`default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${frameAncestors.join(" ")}; sandbox`

const PERMISSIONS_POLICY =
	"accelerometer=(), autoplay=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()"

// no-transform keeps a proxy in front (Cloudflare Email Obfuscation, Rocket Loader) from rewriting an
// Artifact's bytes; its rewrites need scripts this origin's CSP blocks, so they only break the page.
const USERCONTENT_CACHE_CONTROL = "private, no-store, no-transform"

const BINARY_DOWNLOAD_KINDS = new Set(["pdf", "docx", "pptx", "xlsx"])
const isBinaryKind = (kind: string): boolean => BINARY_DOWNLOAD_KINDS.has(kind)

const attachmentDisposition = (sourceFilename: string | null, title: string, extension: string): string => {
	const original = sourceFilename?.split(/[\\/]/).pop() || `${title}.${extension}`
	// eslint-disable-next-line no-control-regex -- stripping control chars from a filename
	const filename = original.replace(/[\u0000-\u001f\u007f]/g, "").trim() || `artifact.${extension}`
	const downloadName =
		(extension === "html" || extension === "md") && !filename.toLowerCase().endsWith(`.${extension}`)
			? `${filename}.${extension}`
			: filename
	const ascii = downloadName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
	const encoded = encodeURIComponent(downloadName).replace(
		/['()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	)
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

const redactUsercontentUrl = (url: string): string => url.replace(/^\/uc\/(?!cdn\/)[^/?]+/, "/uc/[redacted]")

const setUsercontentHeaders = (reply: FastifyReply, contentSecurityPolicy: string): FastifyReply =>
	reply
		.header("Content-Security-Policy", contentSecurityPolicy)
		.header("X-Content-Type-Options", "nosniff")
		.header("Cache-Control", USERCONTENT_CACHE_CONTROL)
		.header("Referrer-Policy", "no-referrer")
		.header("X-DNS-Prefetch-Control", "off")
		.header("Cross-Origin-Opener-Policy", "same-origin")
		.header("Permissions-Policy", PERMISSIONS_POLICY)

const serializeRequest = (request: FastifyRequest) => ({
	method: request.method,
	url: redactUsercontentUrl(request.url),
	hostname: request.hostname,
	remoteAddress: request.ip,
	remotePort: request.socket.remotePort,
})

interface LogStream {
	write: (message: string) => void
}

export interface UsercontentAppParams {
	sql: Sql
	secret: string
	objectStore: ObjectStore
	frameAncestors: string[]
	logLevel?: string
	isReady?: () => boolean
	logStream?: LogStream
	/** This origin's public origin; unset disables the CDN proxy and leaves the CSP unchanged. */
	usercontentOrigin?: string
	cdnFetch?: typeof fetch
}

type BodyRevision = NonNullable<Awaited<ReturnType<typeof getRevisionBodyRef>>>

export const buildUsercontentApp = ({
	sql,
	secret,
	objectStore,
	frameAncestors,
	logLevel,
	isReady = () => true,
	logStream,
	usercontentOrigin,
	cdnFetch = fetch,
}: UsercontentAppParams): FastifyInstance => {
	// The signed token is longer than find-my-way's default 100-char route param limit.
	const app = fastify({
		logger: logLevel
			? {
					level: logLevel,
					serializers: { req: serializeRequest },
					...(logStream ? { stream: logStream } : {}),
				}
			: false,
		routerOptions: { maxParamLength: 2048 },
	})
	const csp = buildCsp(frameAncestors, usercontentOrigin)
	// The PDF viewer page is built here and loads nothing from a CDN.
	const pdfViewerCsp = buildCsp(frameAncestors)
	const recordServe = async (callId: string | null, artifactId: string, revisionId: string) => {
		// A token minted by the Link page names the call that page opened. Re-fetching inside the
		// TTL adds serve rows to that one claimed view; it never claims a second view.
		if (callId !== null) await insertUsercontentServe(sql, { callId, artifactId, revisionId })
	}
	const loadVerifiedBody = async (
		request: FastifyRequest<{ Params: { token: string } }>,
		acceptsRevision: (revision: BodyRevision, noDownload: boolean) => boolean,
	): Promise<{ revision: BodyRevision; bytes: Uint8Array; noDownload: boolean } | null> => {
		const verified = verifyUsercontentToken(request.params.token, secret)
		if (!verified.ok || verified.previewSha256 !== undefined) return null
		const noDownload = verified.noDownload === true

		const revision = await getRevisionBodyRef(sql, { revisionId: verified.revisionId })
		if (revision === null || !acceptsRevision(revision, noDownload)) return null

		const bytes = await objectStore.get(revision.storageKey).catch(() => null)
		if (bytes === null || createHash("sha256").update(bytes).digest("hex") !== revision.sha256) return null

		await recordServe(verified.callId, revision.artifactId, revision.id)
		return { revision, bytes, noDownload }
	}
	const serveBody = async (
		request: FastifyRequest<{ Params: { token: string }; Querystring: { download?: string } }>,
		reply: FastifyReply,
		expectedKind?: string,
	) => {
		const loaded = await loadVerifiedBody(request, (revision, noDownload) => {
			if (expectedKind !== undefined && revision.kind !== expectedKind) return false
			// A reader whose Owner withheld download gets no route whose only use is saving a file:
			// `download=1`, the root body of a binary kind, and a browser navigating to `/file.pptx` itself. The PDF
			// viewer, the embedded PPTX viewer's fetch (not a navigation) and `/preview` keep working.
			if (
				noDownload &&
				(request.query.download === "1" ||
					(isBinaryKind(revision.kind) &&
						(expectedKind === undefined || request.headers["sec-fetch-mode"] === "navigate")))
			) {
				return false
			}
			return (
				(revision.kind === "html" && (revision.mime === "text/html" || revision.mime === "text/markdown")) ||
				isBinaryKind(revision.kind) ||
				(revision.kind === "image" && buildImageCsp(revision.mime, frameAncestors) !== null)
			)
		})
		if (loaded === null) return reply.callNotFound()
		const { revision, bytes, noDownload } = loaded

		const isHtml = revision.kind === "html" && revision.mime === "text/html"
		const isMarkdown = revision.kind === "html" && revision.mime === "text/markdown"
		const isBinaryDownload = isBinaryKind(revision.kind)
		const imageCsp = revision.kind === "image" ? buildImageCsp(revision.mime, frameAncestors) : null
		const contentType = isHtml
			? "text/html; charset=utf-8"
			: isMarkdown
				? "text/plain; charset=utf-8"
				: isBinaryDownload
					? "application/octet-stream"
					: revision.mime
		const contentSecurityPolicy = isMarkdown || isBinaryDownload ? buildTextCsp(frameAncestors) : (imageCsp ?? csp)
		setUsercontentHeaders(reply, contentSecurityPolicy).type(contentType)
		const downloadAsAttachment =
			!noDownload && (isBinaryDownload || ((isHtml || isMarkdown) && request.query.download === "1"))
		if (downloadAsAttachment) {
			const extension = isBinaryDownload ? revision.kind : isHtml ? "html" : "md"
			reply.header("Content-Disposition", attachmentDisposition(revision.filename, revision.title, extension))
		} else if (noDownload && isBinaryDownload) {
			// `/file.pptx` feeds an embedded viewer that has to fetch the bytes, never save them.
			reply.header("Content-Disposition", "inline")
		}
		// Inline HTML gets the inline shims and CDN rewrite; downloads and every other kind stay byte-exact.
		const body =
			isHtml && !downloadAsAttachment
				? injectInlineShims(usercontentOrigin === undefined ? bytes : rewriteCdnUrls(bytes))
				: Buffer.from(bytes)
		reply.header("Content-Length", String(body.byteLength))
		return reply.send(body)
	}

	app.get("/readiness", (_request, reply) => {
		if (!isReady()) return reply.code(503).type("text/plain").send("NOT READY")
		return reply.type("text/plain").send("OK")
	})

	// This origin decides nothing about access: the signed token is the whole authority, minted on
	// the API origin after the visibility boundary resolved the Revision.
	app.get<{ Params: { token: string }; Querystring: { download?: string } }>("/uc/:token", serveBody)
	app.get<{ Params: { token: string }; Querystring: { download?: string } }>("/uc/:token/file.pptx", (request, reply) =>
		serveBody(request, reply, "pptx"),
	)
	app.get<{ Params: { token: string } }>("/uc/:token/view", async (request, reply) => {
		const loaded = await loadVerifiedBody(request, (revision) => revision.kind === "pdf")
		if (loaded === null) return reply.callNotFound()
		const { bytes } = loaded

		const html = buildPdfViewerHtml({ dataBase64: Buffer.from(bytes).toString("base64") })
		const body = Buffer.from(html, "utf8")
		setUsercontentHeaders(reply, pdfViewerCsp)
			.header("Content-Length", String(body.byteLength))
			.type("text/html; charset=utf-8")
		return reply.send(body)
	})

	app.get<{ Params: { token: string } }>("/uc/:token/preview", async (request, reply) => {
		const verified = verifyUsercontentToken(request.params.token, secret)
		if (!verified.ok || verified.previewSha256 === undefined) return reply.callNotFound()
		const [preview] = await sql<{ artifactId: string; html: string; kind: string }[]>`
			SELECT r.artifact_id, p.html, a.kind
			FROM "exagram"."revision_previews" p
			JOIN "exagram"."revisions" r ON r.id = p.revision_id
			JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
			WHERE p.revision_id = ${verified.revisionId}::uuid AND p.html IS NOT NULL
		`
		if (!preview || !["pdf", "docx", "pptx", "xlsx"].includes(preview.kind)) return reply.callNotFound()
		const bytes = Buffer.from(preview.html, "utf8")
		if (createHash("sha256").update(bytes).digest("hex") !== verified.previewSha256) return reply.callNotFound()
		await recordServe(verified.callId, preview.artifactId, verified.revisionId)
		return reply
			.header(
				"Content-Security-Policy",
				[
					"default-src 'none'",
					"script-src 'none'",
					"style-src 'unsafe-inline'",
					"img-src data: blob:",
					"font-src data:",
					"media-src data: blob:",
					"connect-src 'none'",
					"frame-src 'none'",
					"worker-src 'none'",
					"object-src 'none'",
					"base-uri 'none'",
					"form-action 'none'",
					`frame-ancestors ${frameAncestors.join(" ")}`,
					"sandbox",
				].join("; "),
			)
			.header("X-Content-Type-Options", "nosniff")
			.header("Cache-Control", USERCONTENT_CACHE_CONTROL)
			.header("Referrer-Policy", "no-referrer")
			.header("X-DNS-Prefetch-Control", "off")
			.header("Cross-Origin-Opener-Policy", "same-origin")
			.header("Permissions-Policy", PERMISSIONS_POLICY)
			.header("Content-Length", String(bytes.byteLength))
			.type("text/html; charset=utf-8")
			.send(bytes)
	})

	if (usercontentOrigin !== undefined) {
		const proxy = createCdnProxy({ fetch: cdnFetch })
		const PREFIX = "/uc/cdn/"
		app.get(`${PREFIX}*`, async (request, reply) => {
			// The raw URL, not the decoded wildcard param: the allowlist is checked on what the client sent.
			const url = canonicalCdnUrl((request.raw.url ?? "").slice(PREFIX.length))
			if (url === null) return reply.callNotFound()
			const result = await proxy.get(url)
			switch (result.kind) {
				case "ok":
					return reply
						.header("Content-Type", result.contentType)
						.header("Content-Length", String(result.bytes.byteLength))
						.header("Cache-Control", result.cacheControl)
						.header("Access-Control-Allow-Origin", "*")
						.header("X-Content-Type-Options", "nosniff")
						.header("Content-Security-Policy", "default-src 'none'; sandbox")
						.header("Cross-Origin-Resource-Policy", "cross-origin")
						.header("Referrer-Policy", "no-referrer")
						.send(result.bytes)
				case "not_found":
					return reply.callNotFound()
				case "busy":
					return reply
						.code(503)
						.header("Cache-Control", "no-store")
						.header("Retry-After", "1")
						.type("text/plain")
						.send("busy")
				case "upstream_error":
					return reply.code(502).header("Cache-Control", "no-store").type("text/plain").send("bad gateway")
			}
		})
	}

	app.setNotFoundHandler((_request, reply) => {
		reply
			.code(404)
			.header("Cache-Control", "private, no-store")
			.header("X-Content-Type-Options", "nosniff")
			.header("Content-Security-Policy", "default-src 'none'; sandbox")
			.type("text/plain")
			.send("not found")
	})

	return app
}
