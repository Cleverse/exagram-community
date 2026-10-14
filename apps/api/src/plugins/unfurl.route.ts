import { getArtifactUnfurl, getProjectUnfurl } from "@exagram/core/repository/postgres/gen/exagram_unfurl_sql"
import { escapeHtml } from "@exagram/core/utils/html"

import type { FastifyInstance, FastifyReply } from "fastify"
import type { Sql } from "postgres"

// Any hex UUID, as Postgres itself accepts; anything else never reaches the database.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SITE_NAME = "Exagram"
const GENERIC_DESCRIPTION = "A document shared on Exagram"

const KIND_LABEL: Record<string, string> = {
	doc: "Doc",
	html: "HTML",
	chat: "Chat",
	pdf: "PDF",
	docx: "Word",
	pptx: "PowerPoint",
	xlsx: "Excel",
}

// `private`, never `public`: Caddy and the Pages Function serve this page at the SPA's own URL, and
// a shared cache that ignores Vary (Cloudflare "Cache Everything" in front of Caddy) could otherwise
// hand it to a person. One minute bounds how long an unfurler keeps a title the Owner has just hidden. The same value for every outcome, so the headers never tell generic from metadata apart.
const CACHE_CONTROL = "private, max-age=60"

type Target = "artifacts" | "projects"

const renderPage = (input: { title: string; description: string; url: string; image: string }): string => {
	const title = escapeHtml(input.title)
	const description = escapeHtml(input.description)
	const url = escapeHtml(input.url)
	const image = escapeHtml(input.image)
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image}">
</head><body><p><a href="${url}">${title}</a></p></body></html>`
}

export interface UnfurlRouteParams {
	sql: Sql
	/** The SPA's origin: og:url and the body's link point at the page a person would open. */
	webOrigin: string
	/** Shown after the kind: the edition's label for the Workspace, its name or a fixed one. */
	workspaceLabel: (workspaceName: string) => string
}

/**
 * `GET /v1/unfurl/{artifacts|projects}/:id`: the page a link unfurler (Slackbot and friends) gets for
 * an Exagram URL, routed here by User-Agent from a proxy in front of the web app (the bundled Caddy does it).
 * Unauthenticated: title, kind and the edition's label when the Project allows it, otherwise one generic
 * page that is the same for a hidden, deleted, unknown or malformed id, so it answers no question
 * about existence. Never a body, never a ledger entry, never a view claim.
 */
export const registerUnfurlRoute = (app: FastifyInstance, params: UnfurlRouteParams): void => {
	const send = (reply: FastifyReply, page: string) =>
		reply
			.header("Cache-Control", CACHE_CONTROL)
			.header("Content-Security-Policy", "default-src 'none'; base-uri 'none'; form-action 'none'")
			.header("X-Content-Type-Options", "nosniff")
			// Same reasoning as the Link page: set here for when nothing in front of the api host adds it.
			.header("X-Frame-Options", "DENY")
			.header("Referrer-Policy", "strict-origin-when-cross-origin")
			.header("X-Robots-Tag", "noindex")
			// The proxy serves this at the SPA's own URL for bot User-Agents only; a cache must never
			// hand it to a browser in place of the SPA.
			.header("Vary", "User-Agent")
			.type("text/html; charset=utf-8")
			.send(page)

	// One static card for every page, generic or not, so the image never tells them apart either.
	// Served by the SPA's host from `apps/web/public/og.png`.
	const image = `${params.webOrigin}/og.png`

	const handle = async (target: Target, rawId: string, reply: FastifyReply) => {
		// Every generic page is byte-identical, malformed ids included: it points at the site root and
		// echoes nothing from the request.
		const generic = () =>
			send(
				reply,
				renderPage({ title: SITE_NAME, description: GENERIC_DESCRIPTION, url: `${params.webOrigin}/`, image }),
			)
		if (!UUID_SHAPE.test(rawId)) return generic()
		const id = rawId.toLowerCase()
		const url = `${params.webOrigin}/${target}/${id}`

		if (target === "artifacts") {
			const row = await getArtifactUnfurl(params.sql, { id })
			if (row === null) return generic()
			const kind = KIND_LABEL[row.kind] ?? "File"
			return send(
				reply,
				renderPage({
					title: row.title,
					description: `${kind} · ${params.workspaceLabel(row.workspaceName)}`,
					url,
					image,
				}),
			)
		}

		const row = await getProjectUnfurl(params.sql, { id })
		if (row === null) return generic()
		return send(
			reply,
			renderPage({ title: row.name, description: `Folder · ${params.workspaceLabel(row.workspaceName)}`, url, image }),
		)
	}

	app.get<{ Params: { id: string } }>("/v1/unfurl/artifacts/:id", (request, reply) =>
		handle("artifacts", request.params.id, reply),
	)
	app.get<{ Params: { id: string } }>("/v1/unfurl/projects/:id", (request, reply) =>
		handle("projects", request.params.id, reply),
	)
}
