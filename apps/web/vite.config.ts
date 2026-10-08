import { readFileSync, rmSync } from "node:fs"
import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

// In compose the API is another container; on a laptop it is localhost:3000.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000"

/**
 * Same-origin API: the session cookie and the oidc-provider interaction cookie stay first-party.
 * `/oauth/consent/<uid>` itself is the one path under `/oauth` the app serves — it is a React route
 * (Task P6-20). Everything below it still proxies, because oidc-provider scopes the `_interaction`
 * cookie to that exact path, so the consent procedures live under it (Task P6-19) to receive it.
 * A regex key is a Vite proxy pattern, so the negative lookahead keeps the page here.
 */
const proxy = {
	"/v1": { target: apiTarget, changeOrigin: false },
	"^/oauth/(?!consent/[^/]+$)": { target: apiTarget, changeOrigin: false },
	"/mcp": { target: apiTarget, changeOrigin: false },
	"/.well-known": { target: apiTarget, changeOrigin: false },
	// `GET /l/:token` (a Link) is served by the API itself, not a React route — see link-page.route.ts.
	"/l": { target: apiTarget, changeOrigin: false },
}

// A tunnel (zrok, ngrok) sends its own Host header, which Vite rejects unless it is listed here.
const allowedHosts =
	process.env.VITE_ALLOWED_HOSTS === "all" ? true : (process.env.VITE_ALLOWED_HOSTS?.split(",") ?? [])

/**
 * One id per build, baked into the bundle and written to `dist/version.json`; an open tab polls the file
 * and offers a reload when the two differ (src/features/webUpdate). Pages builds use the commit; any
 * other build (the self-host image) uses its build time, so every rebuild counts as new.
 */
const buildId = process.env.CF_PAGES_COMMIT_SHA ?? new Date().toISOString()

/**
 * The web release this build belongs to, `apps/web/package.json`'s `version`. Pages builds before the
 * `web@vX.Y.Z` tag exists, so the release PR bumps it and the tag matches it; the tab names it after an
 * update reload.
 */
const release = (
	JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8")) as {
		version?: unknown
	}
).version

const webVersion = (): Plugin => ({
	name: "exagram-web-version",
	apply: "build",
	generateBundle() {
		this.emitFile({ type: "asset", fileName: "version.json", source: `${JSON.stringify({ buildId })}\n` })
	},
})

/** `_headers.community` is the Community strip's variant of `_headers`; Vite copies all of `public/`, so a Cloud build drops it. */
const dropCommunityHeaders = (): Plugin => ({
	name: "exagram-drop-community-headers",
	apply: "build",
	closeBundle() {
		rmSync(path.resolve(import.meta.dirname, "dist/_headers.community"), { force: true })
	},
})

export default defineConfig(({ command }) => ({
	resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
	server: { host: "0.0.0.0", port: 5173, strictPort: true, proxy, allowedHosts },
	preview: { host: "0.0.0.0", port: 5173, strictPort: true, proxy, allowedHosts },
	plugins: [react(), tailwindcss(), webVersion(), dropCommunityHeaders()],
	// Dev has no `version.json`, so it gets no id and never polls.
	define: {
		__WEB_BUILD_ID__: command === "build" ? JSON.stringify(buildId) : "undefined",
		__WEB_RELEASE__: typeof release === "string" ? JSON.stringify(release) : "undefined",
	},
	build: { target: "es2022" },
}))
