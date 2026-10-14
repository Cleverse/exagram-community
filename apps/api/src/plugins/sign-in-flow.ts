import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { z } from "zod"

import type { OfferChoice } from "../usecase/auth/auth.usecase"

// A same-origin file path only: no query, no host, no other route. Checked at start and again at the callback.
const RETURN_TO_PATTERN = /^\/(artifacts|projects)\/[0-9a-f-]{36}$/

export const ReturnToSchema = z.string().regex(RETURN_TO_PATTERN)

export const ChoiceSchema = z.enum(["join", "create"])

export const offerIsWhole = (value: { choice?: string; workspaceId?: string }): boolean =>
	(value.choice === "join") === (value.workspaceId !== undefined)

// An older client still names a Workspace to create; it asked for a new account, which is now a Personal one.
export const offerChoice = (value: {
	choice?: "join" | "create"
	workspaceId?: string
	workspaceName?: string
}): OfferChoice | undefined => {
	if (value.choice === "create" || value.workspaceName !== undefined) return "create"
	return value.choice === "join" && value.workspaceId !== undefined ? { join: value.workspaceId } : undefined
}

export const randomBase64Url = (): string => randomBytes(32).toString("base64url")

/** HMAC-signed, not sealed: what it carries is the browser's own, and a cookie it alone holds binds it there. */
export const signPayload = (payload: object, key: Buffer): string => {
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
	const signature = createHmac("sha256", key).update(body).digest("base64url")
	return `${body}.${signature}`
}

/** The JSON a value from `signPayload` carries, or null when it is malformed or signed under another key. */
export const openPayload = (value: string, key: Buffer): unknown => {
	try {
		const [body, signature, ...extra] = value.split(".")
		if (!body || !signature || extra.length > 0) return null
		const expected = createHmac("sha256", key).update(body).digest("base64url")
		if (!constantTimeEqual(signature, expected)) return null
		return JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
	} catch {
		return null
	}
}

export const cookieValues = (header: string | string[] | undefined, name: string): string[] => {
	const raw = Array.isArray(header) ? header.join(";") : (header ?? "")
	const values: string[] = []
	for (const part of raw.split(";")) {
		const separator = part.indexOf("=")
		if (separator < 0 || part.slice(0, separator).trim() !== name) continue
		values.push(part.slice(separator + 1).trim())
	}
	return values
}

export const constantTimeEqual = (left: string, right: string): boolean => {
	const leftBytes = Buffer.from(left)
	const rightBytes = Buffer.from(right)
	return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export const webRedirect = (webOrigin: string, path: string, code?: string): string => {
	const url = new URL(path, `${webOrigin.replace(/\/$/, "")}/`)
	if (code) url.searchParams.set("error", code)
	return url.toString()
}

export const offerPath = (workspaceId: string): string => `/join/offer?workspaceId=${encodeURIComponent(workspaceId)}`
