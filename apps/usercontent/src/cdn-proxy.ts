// ADR 0037: usercontent fetches a few public CDN files itself and serves them from /uc/cdn/*, so the
// viewer's browser never contacts the CDN and the page CSP can stay network-free.

export const CDN_HOSTS = [
	"cdnjs.cloudflare.com",
	"cdn.jsdelivr.net",
	"unpkg.com",
	"fonts.googleapis.com",
	"fonts.gstatic.com",
] as const

const MAX_PATH_CHARS = 512
const MAX_QUERY_CHARS = 1024
const PATH_CHARS = /^[A-Za-z0-9\-._~@+/]+$/
const QUERY_CHARS = /^[A-Za-z0-9+:;@,.&=_%|-]+$/

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
const NAME = String.raw`[A-Za-z0-9._-]+`
const PKG = String.raw`(?:@${NAME}/)?${NAME}`

const PATH_SHAPES: Record<(typeof CDN_HOSTS)[number], RegExp> = {
	"cdnjs.cloudflare.com": new RegExp(String.raw`^/ajax/libs/${NAME}/[0-9A-Za-z][0-9A-Za-z._-]*/.+$`),
	"cdn.jsdelivr.net": new RegExp(String.raw`^/npm/${PKG}@${SEMVER}(?:/.*)?$`),
	"unpkg.com": new RegExp(String.raw`^/${PKG}@${SEMVER}/.+$`),
	"fonts.googleapis.com": /^\/css2?$/,
	"fonts.gstatic.com": /^\/s\/[a-z0-9]+\/v\d+\/[A-Za-z0-9._-]+\.(?:woff2|woff|ttf|otf)$/,
}

const isCdnHost = (host: string): host is (typeof CDN_HOSTS)[number] => (CDN_HOSTS as readonly string[]).includes(host)

/**
 * Validates the part of the request URL after `/uc/cdn/`, exactly as received (never decoded), and
 * returns the one canonical upstream URL, which is also the cache key.
 */
export const canonicalCdnUrl = (rawPathAndQuery: string): string | null => {
	if (rawPathAndQuery.includes("#")) return null
	const queryStart = rawPathAndQuery.indexOf("?")
	const hostAndPath = queryStart === -1 ? rawPathAndQuery : rawPathAndQuery.slice(0, queryStart)
	const query = queryStart === -1 ? undefined : rawPathAndQuery.slice(queryStart + 1)

	const slash = hostAndPath.indexOf("/")
	if (slash === -1) return null
	const host = hostAndPath.slice(0, slash)
	const path = hostAndPath.slice(slash)
	if (!isCdnHost(host)) return null

	if (path.length > MAX_PATH_CHARS || !PATH_CHARS.test(path)) return null
	for (const segment of path.slice(1).split("/")) {
		if (segment === "" || segment === "." || segment === "..") return null
	}
	if (!PATH_SHAPES[host].test(path)) return null

	if (host === "fonts.googleapis.com") {
		if (query === undefined || query.length > MAX_QUERY_CHARS || !QUERY_CHARS.test(query)) return null
		return `https://${host}${path}?${query}`
	}
	if (query !== undefined) return null
	return `https://${host}${path}`
}

export type CdnResult =
	| { kind: "ok"; bytes: Buffer; contentType: string; cacheControl: string }
	| { kind: "not_found" }
	| { kind: "busy" }
	| { kind: "upstream_error" }

export interface CdnProxyOptions {
	fetch: typeof fetch
	maxFileBytes?: number
	maxCacheBytes?: number
	maxConcurrentFetches?: number
	fetchTimeoutMs?: number
	notFoundTtlMs?: number
	maxNotFoundEntries?: number
	now?: () => number
}

// Google Fonts serves woff2 with unicode-range only to browser User-Agents; one fixed UA keeps the
// cached CSS identical for every viewer.
const CHROME_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const ALLOWED_CONTENT_TYPES = new Set([
	"text/javascript",
	"application/javascript",
	"application/x-javascript",
	"text/css",
	"font/woff2",
	"font/woff",
	"font/ttf",
	"font/otf",
	"font/sfnt",
	"application/font-woff",
	"application/font-woff2",
	"application/x-font-woff",
	"application/x-font-ttf",
	"application/x-font-opentype",
	"application/vnd.ms-fontobject",
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
])

const IMMUTABLE = "public, max-age=31536000, immutable"
const FONTS_CSS = "public, max-age=86400"

type OkResult = Extract<CdnResult, { kind: "ok" }>

export const createCdnProxy = ({
	fetch: upstreamFetch,
	maxFileBytes = 8 * 1024 * 1024,
	maxCacheBytes = 64 * 1024 * 1024,
	maxConcurrentFetches = 8,
	fetchTimeoutMs = 10_000,
	notFoundTtlMs = 5 * 60_000,
	maxNotFoundEntries = 1024,
	now = Date.now,
}: CdnProxyOptions) => {
	const cache = new Map<string, OkResult>()
	let cacheBytes = 0
	const notFound = new Map<string, number>()
	const inflight = new Map<string, Promise<CdnResult>>()

	const remember = (url: string, result: OkResult) => {
		if (result.bytes.byteLength > maxFileBytes || result.bytes.byteLength > maxCacheBytes) return
		cache.set(url, result)
		cacheBytes += result.bytes.byteLength
		for (const [key, entry] of cache) {
			if (cacheBytes <= maxCacheBytes) break
			cache.delete(key)
			cacheBytes -= entry.bytes.byteLength
		}
	}

	const rememberMissing = (url: string) => {
		notFound.delete(url)
		notFound.set(url, now() + notFoundTtlMs)
		for (const key of notFound.keys()) {
			if (notFound.size <= maxNotFoundEntries) break
			notFound.delete(key)
		}
	}

	const readBounded = async (response: Response): Promise<Buffer | null> => {
		const declared = Number(response.headers.get("content-length"))
		if (Number.isFinite(declared) && declared > maxFileBytes) {
			await response.body?.cancel().catch(() => undefined)
			return null
		}
		if (!response.body) return Buffer.alloc(0)
		const reader = response.body.getReader()
		const chunks: Uint8Array[] = []
		let total = 0
		for (;;) {
			const chunk = (await reader.read()) as { done: true; value?: undefined } | { done: false; value: Uint8Array }
			if (chunk.done) break
			const value = chunk.value
			total += value.byteLength
			if (total > maxFileBytes) {
				await reader.cancel().catch(() => undefined)
				return null
			}
			chunks.push(value)
		}
		return Buffer.concat(chunks)
	}

	const load = async (url: string): Promise<CdnResult> => {
		try {
			const response = await upstreamFetch(url, {
				redirect: "manual",
				signal: AbortSignal.timeout(fetchTimeoutMs),
				headers: { "user-agent": CHROME_UA, accept: "*/*" },
			})
			if (response.status >= 500) {
				await response.body?.cancel().catch(() => undefined)
				return { kind: "upstream_error" }
			}
			const contentType = response.headers.get("content-type") ?? ""
			const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? ""
			if (response.status === 429) {
				await response.body?.cancel().catch(() => undefined)
				return { kind: "upstream_error" }
			}
			if (response.status !== 200 || !ALLOWED_CONTENT_TYPES.has(essence)) {
				await response.body?.cancel().catch(() => undefined)
				// Only definite answers are remembered; other 4xx (403, 408, ...) may be transient.
				if (response.status === 200 || response.status === 404 || response.status === 410 || response.status < 400) {
					rememberMissing(url)
				}
				return { kind: "not_found" }
			}
			const body = await readBounded(response)
			if (body === null) {
				rememberMissing(url)
				return { kind: "not_found" }
			}
			const isFontsCss = url.startsWith("https://fonts.googleapis.com/") && essence === "text/css"
			const result: OkResult = {
				kind: "ok",
				bytes: isFontsCss
					? Buffer.from(
							body.toString("utf8").replaceAll("https://fonts.gstatic.com/", "/uc/cdn/fonts.gstatic.com/"),
							"utf8",
						)
					: body,
				contentType,
				cacheControl: isFontsCss ? FONTS_CSS : IMMUTABLE,
			}
			remember(url, result)
			return result
		} catch {
			return { kind: "upstream_error" }
		}
	}

	const get = (url: string): Promise<CdnResult> => {
		const hit = cache.get(url)
		if (hit) {
			cache.delete(url)
			cache.set(url, hit)
			return Promise.resolve(hit)
		}
		const missingUntil = notFound.get(url)
		if (missingUntil !== undefined) {
			if (missingUntil > now()) return Promise.resolve({ kind: "not_found" })
			notFound.delete(url)
		}
		const shared = inflight.get(url)
		if (shared) return shared
		if (inflight.size >= maxConcurrentFetches) return Promise.resolve({ kind: "busy" })
		const started = load(url).finally(() => inflight.delete(url))
		inflight.set(url, started)
		return started
	}

	return { get }
}
