import { timingSafeEqual } from "node:crypto"

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"

export interface GoogleProfile {
	sub: string
	email: string
	name?: string
	hd?: string
}

export interface GoogleOidcServiceOptions {
	fetch?: typeof globalThis.fetch
	jwks?: JWTVerifyGetKey
}

export class GoogleOidcService {
	private readonly fetch: typeof globalThis.fetch
	private readonly jwks: JWTVerifyGetKey

	constructor(
		private readonly clientId: string,
		private readonly clientSecret: string,
		options: GoogleOidcServiceOptions = {},
	) {
		this.fetch = options.fetch ?? globalThis.fetch
		this.jwks = options.jwks ?? createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))
	}

	buildAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string {
		const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
		url.search = new URLSearchParams({
			client_id: this.clientId,
			response_type: "code",
			scope: "openid email profile",
			state: input.state,
			nonce: input.nonce,
			code_challenge: input.codeChallenge,
			code_challenge_method: "S256",
			prompt: "select_account",
			redirect_uri: input.redirectUri,
		}).toString()
		return url.toString()
	}

	async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string }> {
		const response = await this.fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code: input.code,
				client_id: this.clientId,
				client_secret: this.clientSecret,
				code_verifier: input.codeVerifier,
				redirect_uri: input.redirectUri,
				grant_type: "authorization_code",
			}).toString(),
			signal: AbortSignal.timeout(10_000),
		})
		if (!response.ok) throw new Error("Google token exchange failed")
		const body = (await response.json()) as { id_token?: unknown }
		if (typeof body.id_token !== "string" || body.id_token.length === 0) throw new Error("Google token exchange failed")
		return { idToken: body.id_token }
	}

	async verifyIdToken(idToken: string, nonce: string): Promise<GoogleProfile> {
		const { payload } = await jwtVerify(idToken, this.jwks, {
			algorithms: ["RS256"],
			issuer: ["https://accounts.google.com", "accounts.google.com"],
			audience: this.clientId,
			requiredClaims: ["exp", "iat", "sub"],
		})
		if (payload.azp !== undefined && payload.azp !== this.clientId) {
			throw new Error("Google ID token authorized party mismatch")
		}
		if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== this.clientId) {
			throw new Error("Google ID token authorized party is required")
		}
		if (typeof payload.nonce !== "string" || !constantTimeEqual(payload.nonce, nonce)) {
			throw new Error("Google ID token nonce mismatch")
		}
		if (payload.email_verified !== true) throw new Error("Google email is not verified")
		if (typeof payload.sub !== "string" || payload.sub.length === 0)
			throw new Error("Google ID token subject is missing")
		if (typeof payload.email !== "string" || payload.email.length === 0)
			throw new Error("Google ID token email is missing")

		return {
			sub: payload.sub,
			email: payload.email,
			...(typeof payload.name === "string" ? { name: payload.name } : {}),
			...(typeof payload.hd === "string" && payload.hd.length > 0 ? { hd: payload.hd } : {}),
		}
	}
}

const constantTimeEqual = (left: string, right: string): boolean => {
	const leftBytes = Buffer.from(left)
	const rightBytes = Buffer.from(right)
	return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}
