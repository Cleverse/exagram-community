import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

const UploadTokenPayloadSchema = z.object({
	storageKey: z.string().min(1),
	bytes: z.number().int().positive(),
	mime: z.string().min(1),
	/** Epoch milliseconds. */
	expiresAt: z.number().int(),
})

export type UploadTokenPayload = z.infer<typeof UploadTokenPayloadSchema>

/**
 * The filesystem driver's stand-in for a presigned URL: `base64url(JSON payload).base64url(HMAC)`,
 * keyed by UPLOAD_TOKEN_SECRET alone so a leak of another app secret can't mint one.
 */
export class UploadTokenSigner {
	constructor(private readonly secret: string) {}

	private mac(encodedPayload: string): Buffer {
		return createHmac("sha256", this.secret).update(encodedPayload).digest()
	}

	sign(payload: UploadTokenPayload): string {
		const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
		return `${encoded}.${this.mac(encoded).toString("base64url")}`
	}

	/** The payload, or null for a malformed, forged or expired token. */
	verify(token: string, now: number = Date.now()): UploadTokenPayload | null {
		const parts = token.split(".")
		if (parts.length !== 2) return null
		const [encoded, signature] = parts as [string, string]
		const given = Buffer.from(signature, "base64url")
		const expected = this.mac(encoded)
		if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

		let json: unknown
		try {
			json = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
		} catch {
			return null
		}
		const parsed = UploadTokenPayloadSchema.safeParse(json)
		if (!parsed.success || parsed.data.expiresAt <= now) return null
		return parsed.data
	}
}
