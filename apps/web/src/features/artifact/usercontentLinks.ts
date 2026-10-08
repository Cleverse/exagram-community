import { USERCONTENT_ORIGIN } from "@/config/env"

const OPEN_LINK = "exagram:open-link"

// VITE_USERCONTENT_ORIGIN is only checked as a URL, so it may carry a trailing slash.
const UC_ORIGIN = new URL(USERCONTENT_ORIGIN).origin

const isUsercontentFrame = (source: MessageEventSource | null): boolean => {
	if (source === null) return false
	for (const frame of document.querySelectorAll("iframe")) {
		if (frame.contentWindow !== source) continue
		try {
			return new URL(frame.src).origin === UC_ORIGIN
		} catch {
			return false
		}
	}
	return false
}

const linkOf = (data: unknown): URL | null => {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return null
	const { type, url } = data as { type?: unknown; url?: unknown }
	if (type !== OPEN_LINK || typeof url !== "string") return null
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
		if (parsed.origin === UC_ORIGIN) return null
		return parsed
	} catch {
		return null
	}
}

/**
 * HTML Artifacts run in a sandboxed usercontent frame that cannot open popups, and a framed link target
 * usually refuses to load, so its link shim asks the embedding page (ADR 0038). The message is untrusted
 * data: it is accepted only from a usercontent iframe's window (`event.origin` is "null" for a sandboxed
 * frame, so it proves nothing) and only as an http(s) URL outside the usercontent origin.
 */
export const installUsercontentLinks = (): (() => void) => {
	const onMessage = (event: MessageEvent) => {
		if (!isUsercontentFrame(event.source)) return
		const url = linkOf(event.data)
		if (url === null) return
		window.open(url.href, "_blank", "noopener,noreferrer")
	}
	window.addEventListener("message", onMessage)
	return () => window.removeEventListener("message", onMessage)
}
