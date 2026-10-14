import { createHash, randomBytes } from "node:crypto"

import { ALLOWED_MIME_TYPES, EXTRACTED_KINDS, type ArtifactKind } from "@exagram/core/entity/artifact"
import { getRevisionBodyRef } from "@exagram/core/repository/postgres/gen/exagram_usercontent_sql"
import { hashLinkToken } from "@exagram/core/services/link-token.service"
import { mintUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { escapeHtml } from "@exagram/core/utils/html"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { LinksDatagateway } from "@exagram/core/datagateway/links.datagateway"
import type { ObjectStore } from "@exagram/core/services/object-store.service"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

import type { FastifyInstance, FastifyReply } from "fastify"

const INLINE_KINDS = new Set(["doc", "chat"])

const REFUSAL_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><p>not found</p></body></html>`

/** Marks the Link refusal itself, so the page script never mistakes another 404 for a gone Link. */
const REFUSAL_HEADER = "X-Exagram-Link"

const REFUSAL_CONTENT_SECURITY_POLICY = "default-src 'none'; base-uri 'none'; form-action 'none'"

/**
 * Watches `<token>/events` and hides the content once the Link is revoked, expires or its Artifact is
 * deleted. A stream that ends any other way reconnects. EventSource never exposes the status, so a refused
 * reconnect is told apart by a probe: only a 404 carrying the Link refusal header hides the content, so a
 * proxy's or router's own 404, a 429 or a 502 never does.
 */
const LIVE_STATUS_SCRIPT = `(function () {
var url = location.pathname.replace(/\\/+$/, "") + "/events";
var gone = function () {
document.querySelectorAll("iframe, img, pre").forEach(function (node) { node.remove(); });
document.getElementById("link-gone").hidden = false;
};
var connect = function () {
var source = new EventSource(url);
source.addEventListener("state", function (event) {
if (JSON.parse(event.data).state === "gone") { source.close(); gone(); }
});
source.onerror = function () {
if (source.readyState !== EventSource.CLOSED) return;
var probe = new AbortController();
fetch(url, { signal: probe.signal, cache: "no-store" }).then(function (response) {
probe.abort();
if (response.status === 404 && response.headers.get("${REFUSAL_HEADER}") === "refused") gone();
else setTimeout(connect, 30000);
}, function () { setTimeout(connect, 30000); });
};
};
connect();
})();`

/**
 * HTML Artifacts cannot open links themselves: the usercontent link shim posts the URL to this
 * page, which opens it in a new tab. The message is untrusted data, accepted only from this page's own
 * iframe and only as an http(s) URL outside the usercontent origin.
 */
const openLinkScript = (usercontentOrigin: string): string => `(function () {
var uc = ${JSON.stringify(usercontentOrigin).replaceAll("<", "\\u003c")};
window.addEventListener("message", function (event) {
var frame = document.querySelector("iframe");
if (!frame || event.source !== frame.contentWindow) return;
var data = event.data;
if (typeof data !== "object" || data === null || Array.isArray(data)) return;
if (data.type !== "exagram:open-link" || typeof data.url !== "string") return;
var url;
try { url = new URL(data.url); } catch (e) { return; }
if (url.protocol !== "http:" && url.protocol !== "https:") return;
if (url.origin === uc) return;
window.open(url.href, "_blank", "noopener,noreferrer");
});
})();`

/** The one refusal a Link path answers with, byte for byte, whatever was wrong with the token. */
export const refuseLink = (reply: FastifyReply) =>
	reply
		.code(404)
		.header("X-Frame-Options", "DENY")
		.header("Referrer-Policy", "strict-origin-when-cross-origin")
		.header("Cache-Control", "private, no-store")
		.header("Content-Security-Policy", REFUSAL_CONTENT_SECURITY_POLICY)
		.header("X-Content-Type-Options", "nosniff")
		.header(REFUSAL_HEADER, "refused")
		.type("text/html; charset=utf-8")
		.send(REFUSAL_PAGE)

const renderPage = (input: {
	title: string
	kind: string
	body: string | null
	frameSrc: string | null
	imageSrc: string | null
	nonce: string
	usercontentOrigin: string
}): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title></head>
<body>
<h1>${escapeHtml(input.title)}</h1>
<p>${escapeHtml(input.kind)}</p>
${
	input.imageSrc !== null
		? `<img src="${escapeHtml(input.imageSrc)}" alt="${escapeHtml(input.title)}" style="display:block;max-width:100%;max-height:80vh;object-fit:contain;margin:auto">`
		: input.frameSrc === null
			? `<pre>${escapeHtml(input.body ?? "")}</pre>`
			: `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" src="${escapeHtml(input.frameSrc)}" width="100%" height="800" title="${escapeHtml(input.title)}"></iframe>`
}
<p id="link-gone" hidden>This Link is no longer available.</p>
<script nonce="${input.nonce}">${LIVE_STATUS_SCRIPT}</script>${
	input.frameSrc === null ? "" : `\n<script nonce="${input.nonce}">${openLinkScript(input.usercontentOrigin)}</script>`
}
</body></html>`

export interface LinkPageParams {
	links: LinksDatagateway
	serve: ServeService
	objectStore: ObjectStore
	usercontentOrigin: string
	usercontentSecret: string
	usercontentTokenTtlSeconds: number
}

export const registerLinkPageRoute = (app: FastifyInstance, params: LinkPageParams): void => {
	app.get<{ Params: { token: string } }>("/l/:token", async (request, reply) => {
		const nonce = randomBytes(16).toString("base64")
		const contentSecurityPolicy = `default-src 'none'; frame-src ${params.usercontentOrigin}; img-src ${params.usercontentOrigin}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'`

		// The bundled Caddy adds these to every APP_HOST response (api and web share an origin there);
		// where nothing sits in front of the api host, the Link page sets its own. Caddy overwrites the
		// same values, so behind Caddy nothing changes.
		reply.header("X-Frame-Options", "DENY").header("Referrer-Policy", "strict-origin-when-cross-origin")

		const refuse = () => refuseLink(reply)

		// An unknown token names no Link and so no principal: there is nothing to ledger against.
		const linkId = await params.links.findIdByTokenHash(hashLinkToken(request.params.token))
		if (linkId === null) return refuse()

		const page = await params.serve
			.serveLink({ linkId, action: "link.open" }, async (tx, resolution, callId) => {
				if (resolution.revisionId === null) throw new RefusalError()
				const revision = await getRevisionBodyRef(tx, { revisionId: resolution.revisionId })
				if (revision === null) throw new RefusalError()

				if (revision.kind === "html") {
					if (revision.mime !== "text/html" && revision.mime !== "text/markdown") throw new RefusalError()
					// The iframe fetch is ledgered against this call, and the view was already claimed
					// above: re-fetching within the token's TTL is one claimed view, not many.
					const token = mintUsercontentToken({ revisionId: revision.id, callId }, params.usercontentSecret, {
						ttlSeconds: params.usercontentTokenTtlSeconds,
					})
					return renderPage({
						title: revision.title,
						kind: revision.kind,
						body: null,
						frameSrc: `${params.usercontentOrigin}/uc/${token}`,
						imageSrc: null,
						nonce,
						usercontentOrigin: params.usercontentOrigin,
					})
				}
				if (revision.kind === "image") {
					if (!ALLOWED_MIME_TYPES.image.has(revision.mime)) throw new RefusalError()
					const token = mintUsercontentToken({ revisionId: revision.id, callId }, params.usercontentSecret, {
						ttlSeconds: params.usercontentTokenTtlSeconds,
					})
					return renderPage({
						title: revision.title,
						kind: revision.kind,
						body: null,
						frameSrc: null,
						imageSrc: `${params.usercontentOrigin}/uc/${token}`,
						nonce,
						usercontentOrigin: params.usercontentOrigin,
					})
				}

				let body = revision.extractedText ?? ""
				if (INLINE_KINDS.has(revision.kind)) {
					const bytes = await params.objectStore.get(revision.storageKey)
					if (createHash("sha256").update(bytes).digest("hex") !== revision.sha256) throw new RefusalError()
					body = Buffer.from(bytes).toString("utf8")
				} else if (!EXTRACTED_KINDS.has(revision.kind as ArtifactKind)) body = ""
				return renderPage({
					title: revision.title,
					kind: revision.kind,
					body,
					frameSrc: null,
					imageSrc: null,
					nonce,
					usercontentOrigin: params.usercontentOrigin,
				})
			})
			// Only a refusal becomes the refusal page; a broken object store is a 500, not a quiet 404.
			.catch((error: unknown) => {
				if (error instanceof RefusalError) return null
				throw error
			})

		if (page === null) return refuse()
		return (
			reply
				// no-transform: a proxy's Email Obfuscation would swap addresses for a decoder this CSP blocks.
				.header("Cache-Control", "private, no-store, no-transform")
				.header("Content-Security-Policy", contentSecurityPolicy)
				.header("X-Content-Type-Options", "nosniff")
				.type("text/html; charset=utf-8")
				.send(page)
		)
	})
}
