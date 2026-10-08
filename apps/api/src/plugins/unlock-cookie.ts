import { hashUnlockToken } from "@exagram/core/services/unlock-token.service"

import { readCookie } from "./cookies"

import type { IncomingHttpHeaders } from "node:http"

/**
 * One cookie per Artifact, so unlocking one never touches another. The name is written here and read here
 * and nowhere else, like the session cookie's. The id is lower-cased because the path accepts either case of a
 * UUID and the database reads them as one, so every spelling must name the same cookie.
 */
export const unlockCookieName = (artifactId: string): string => `exagram_unlock_${artifactId.toLowerCase()}`

/** HttpOnly, SameSite=Lax and Secure under the session cookie's own rule; `maxAgeSeconds` is the Unlock row's lifetime. */
export const buildUnlockCookie = (artifactId: string, token: string, maxAgeSeconds: number, secure: boolean): string =>
	`${unlockCookieName(artifactId)}=${token}; Path=/v1; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`

/**
 * The sha256 the API sends to SQL as `p_unlock` for a request's cookie for this Artifact, or undefined without
 * one (ADR 0044). It only hashes. Whether the hash opens anything is the boundary's decision, so a forged,
 * stale or foreign value is passed on like a genuine one.
 */
export const unlockHashOf = (headers: IncomingHttpHeaders, artifactId: string): string | undefined => {
	const token = readCookie(headers.cookie, unlockCookieName(artifactId))
	return token ? hashUnlockToken(token) : undefined
}
