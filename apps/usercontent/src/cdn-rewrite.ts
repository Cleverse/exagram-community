import { CDN_HOSTS } from "./cdn-proxy"

// Point CDN URLs in script/link/style at the same-origin proxy. Work happens on a latin1
// string so every non-ASCII byte round-trips untouched.

const HOST = CDN_HOSTS.map((host) => host.replaceAll(".", String.raw`\.`)).join("|")
// The lookahead keeps `cdnjs.cloudflare.com.evil.test` and `unpkg.com:8080` out.
const URL_PREFIX = String.raw`(?:https?:)?//(${HOST})(?=[/?#"'\s>)]|$)`

const toProxyPath = (_match: string, host: string): string => `/uc/cdn/${host.toLowerCase()}`

const URL_PREFIX_AT = new RegExp(URL_PREFIX, "iy")

const isSpace = (c: string | undefined): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f"

// Rewrites the CDN URL at the start of the attribute value that begins at `at`; returns the piece to emit.
const rewriteValueAt = (source: string, at: number): { from: number; to: number; text: string } | null => {
	URL_PREFIX_AT.lastIndex = at
	const match = URL_PREFIX_AT.exec(source)
	if (!match) return null
	return { from: at, to: at + match[0].length, text: toProxyPath("", match[1] ?? "") }
}

// One pass over the tag's attributes, linear in the tag length. Returns the index of the closing `>`, which is never
// inside a quoted value, or -1 when the tag doesn't close.
const scanTag = (
	source: string,
	lower: string,
	from: number,
	attribute: string | null,
	patches: { from: number; to: number; text: string }[],
): number => {
	const end = lower.length
	let pos = from
	while (pos < end) {
		while (pos < end && (isSpace(lower[pos]) || lower[pos] === "/")) pos++
		if (lower[pos] === ">") return pos
		const nameStart = pos
		if (lower[pos] === "=") pos++
		while (pos < end && !isSpace(lower[pos]) && !"=/>".includes(lower[pos] ?? "")) pos++
		const name = lower.slice(nameStart, pos)
		while (pos < end && isSpace(lower[pos])) pos++
		if (lower[pos] !== "=") continue
		pos++
		while (pos < end && isSpace(lower[pos])) pos++
		const quote = lower[pos]
		let valueStart = pos
		if (quote === '"' || quote === "'") {
			valueStart = pos + 1
			const close = lower.indexOf(quote, valueStart)
			if (close === -1) return -1
			pos = close + 1
		} else {
			while (pos < end && !isSpace(lower[pos]) && lower[pos] !== ">") pos++
		}
		if (name === attribute) {
			const patch = rewriteValueAt(source, valueStart)
			if (patch) patches.push(patch)
		}
	}
	return -1
}

const CSS_URL = new RegExp(String.raw`(url\(\s*["']?|@import\s*["'])${URL_PREFIX}`, "gi")

export const rewriteCssUrls = (css: string): string =>
	css.replace(CSS_URL, (_m, head: string, host: string) => `${head}${toProxyPath("", host)}`)

const TAG_BOUNDARY = (c: string | undefined): boolean => c === ">" || c === "/" || isSpace(c)

export const rewriteCdnUrls = (bytes: Uint8Array): Buffer => {
	const source = Buffer.from(bytes).toString("latin1")
	// latin1 lowercasing maps each code unit to one code unit, so indexes line up with `source`.
	const lower = source.toLowerCase()
	const patches: { from: number; to: number; text: string }[] = []

	// Single left-to-right scan; every index is visited a bounded number of times.
	let i = lower.indexOf("<")
	while (i !== -1) {
		const kind = lower.startsWith("<script", i)
			? "script"
			: lower.startsWith("<link", i)
				? "link"
				: lower.startsWith("<style", i)
					? "style"
					: null
		const nameEnd = kind === null ? i : i + 1 + kind.length
		if (kind === null || !TAG_BOUNDARY(lower[nameEnd])) {
			i = lower.indexOf("<", i + 1)
			continue
		}
		const patchCount = patches.length
		const attribute = kind === "script" ? "src" : kind === "link" ? "href" : null
		const tagEnd = scanTag(source, lower, nameEnd, attribute, patches)
		if (tagEnd === -1) {
			patches.length = patchCount
			break
		}
		if (kind === "style") {
			const close = lower.indexOf("</style", tagEnd + 1)
			if (close === -1) break
			const css = source.slice(tagEnd + 1, close)
			const rewritten = rewriteCssUrls(css)
			if (rewritten !== css) patches.push({ from: tagEnd + 1, to: close, text: rewritten })
			i = lower.indexOf("<", close + 1)
		} else {
			i = lower.indexOf("<", tagEnd + 1)
		}
	}

	if (patches.length === 0) return Buffer.from(bytes)
	const parts: string[] = []
	let copied = 0
	for (const patch of patches) {
		parts.push(source.slice(copied, patch.from), patch.text)
		copied = patch.to
	}
	parts.push(source.slice(copied))
	return Buffer.from(parts.join(""), "latin1")
}
