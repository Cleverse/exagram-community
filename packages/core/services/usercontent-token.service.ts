import { createHmac, timingSafeEqual } from "node:crypto"

/** The fallback when no caller passes one; `USERCONTENT_TOKEN_TTL_SEC` is what production reads. */
export const USERCONTENT_TOKEN_TTL_SECONDS = 300

export interface UsercontentGrant {
	revisionId: string
	previewSha256?: string
	/**
	 * The `ledger_calls` row this token was minted under, set only by the Link page. The
	 * usercontent origin writes its own `ledger_serves` row against it, so a body fetched through
	 * the iframe is on the record under the same call as the page that framed it.
	 */
	callId?: string
	/**
	 * Set when the reader's Owner withheld download from Anyone with the link. The usercontent
	 * origin then refuses every route that hands the bytes over as a file.
	 */
	noDownload?: true
}

interface SignedPayload {
	revisionId: string
	callId?: string
	previewSha256?: string
	noDownload?: true
	exp: number
}

export interface MintOptions {
	ttlSeconds?: number
	nowSeconds?: number
}

export type UsercontentTokenResult =
	| { ok: true; revisionId: string; callId: string | null; previewSha256?: string; noDownload?: true }
	| { ok: false; reason: "malformed" | "signature" | "expired" }

const sign = (payload: string, secret: string): string =>
	createHmac("sha256", secret).update(payload).digest("base64url")

/** Mint only after the visibility boundary has resolved the Revision this reader is entitled to. */
export const mintUsercontentToken = (grant: UsercontentGrant, secret: string, options: MintOptions = {}): string => {
	const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
	const payload: SignedPayload = {
		revisionId: grant.revisionId,
		...(grant.callId ? { callId: grant.callId } : {}),
		...(grant.previewSha256 ? { previewSha256: grant.previewSha256 } : {}),
		...(grant.noDownload ? { noDownload: true as const } : {}),
		exp: nowSeconds + (options.ttlSeconds ?? USERCONTENT_TOKEN_TTL_SECONDS),
	}
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
	return `${body}.${sign(body, secret)}`
}

/** Signature before expiry: a forged token that also lapsed must read as a forgery, not as stale. */
export const verifyUsercontentToken = (
	token: string | null | undefined,
	secret: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): UsercontentTokenResult => {
	if (!token) return { ok: false, reason: "malformed" }
	const dot = token.lastIndexOf(".")
	if (dot <= 0) return { ok: false, reason: "malformed" }

	const body = token.slice(0, dot)
	const provided = Buffer.from(token.slice(dot + 1))
	const expected = Buffer.from(sign(body, secret))
	if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
		return { ok: false, reason: "signature" }
	}

	let payload: SignedPayload
	try {
		payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedPayload
	} catch {
		return { ok: false, reason: "malformed" }
	}
	if (typeof payload.revisionId !== "string" || typeof payload.exp !== "number") {
		return { ok: false, reason: "malformed" }
	}
	if (payload.previewSha256 !== undefined && !/^[0-9a-f]{64}$/.test(payload.previewSha256)) {
		return { ok: false, reason: "malformed" }
	}
	if (payload.exp < nowSeconds) return { ok: false, reason: "expired" }
	return {
		ok: true,
		revisionId: payload.revisionId,
		callId: payload.callId ?? null,
		...(payload.previewSha256 ? { previewSha256: payload.previewSha256 } : {}),
		...(payload.noDownload === true ? { noDownload: true as const } : {}),
	}
}
