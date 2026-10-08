import { z } from "zod"

const EnvSchema = z.object({
	// Optional when the served index.html names the usercontent origin (see below).
	VITE_USERCONTENT_ORIGIN: z.union([z.literal(""), z.url()]).optional(),
	VITE_API_ORIGIN: z.union([z.literal(""), z.url()]).optional(),
})

export const ENV = EnvSchema.parse(import.meta.env)

/** The web app's own origin, used for clipboard links that must stay on it. */
export const APP_ORIGIN = window.location.origin

/** Empty (the default) means same origin as the web app; a trailing slash is trimmed. */
export const API_ORIGIN = ENV.VITE_API_ORIGIN?.replace(/\/$/, "") || window.location.origin
export const API_BASE_URL = `${API_ORIGIN}/v1`
export const MCP_SERVER_URL = `${API_ORIGIN}/mcp`

/**
 * The Self-hosted web image renders this into index.html from UC_HOST at serve time (deploy/Caddyfile), so one
 * image serves any install. A Cloud build has no such tag and bakes VITE_USERCONTENT_ORIGIN instead.
 */
const USERCONTENT_ORIGIN_META = 'meta[name="exagram-usercontent-origin"]'

const resolveUsercontentOrigin = (): string => {
	const meta = document.querySelector<HTMLMetaElement>(USERCONTENT_ORIGIN_META)
	if (meta !== null) {
		let url: URL | null = null
		try {
			url = new URL(meta.content)
		} catch {
			url = null
		}
		// An origin and nothing else: no path, query or trailing slash, and only https.
		if (url === null || url.protocol !== "https:" || url.origin !== meta.content) {
			throw new Error(`index.html names an invalid usercontent origin: ${JSON.stringify(meta.content)}`)
		}
		return url.origin
	}
	if (!ENV.VITE_USERCONTENT_ORIGIN) {
		throw new Error("No usercontent origin: index.html names none and VITE_USERCONTENT_ORIGIN is unset")
	}
	return ENV.VITE_USERCONTENT_ORIGIN
}

/**
 * §A.6: HTML bodies are only ever framed from the second origin. `revisions.bodyToken` answers with
 * the whole URL, so nothing here builds one; this constant exists so the app can assert at boot that
 * the two origins really differ.
 */
export const USERCONTENT_ORIGIN = resolveUsercontentOrigin()

if (USERCONTENT_ORIGIN === window.location.origin) {
	throw new Error("The usercontent origin must not be the app origin — HTML bodies would run same-origin")
}

if (USERCONTENT_ORIGIN === API_ORIGIN) {
	throw new Error("The usercontent origin must not equal the API origin — HTML bodies would run same-origin")
}
