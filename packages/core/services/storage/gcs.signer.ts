import type { UploadTicket } from "./object-storage.port"
import type { UploadSigner } from "./upload-signer.port"
import type { Bucket } from "@google-cloud/storage"

export interface GcsSignerConfig {
	ticketTtlSeconds: number
	/** Signs `x-goog-if-generation-match: 0` on every ticket; a ticket asking `createOnly` per call gets it regardless. */
	createOnly?: boolean
}

export class GcsUploadSigner implements UploadSigner {
	constructor(
		private readonly bucket: Bucket,
		private readonly config: GcsSignerConfig,
	) {}

	async createUploadTicket(input: {
		storageKey: string
		mime: string
		bytes: number
		createOnly?: boolean
	}): Promise<UploadTicket> {
		const file = this.bucket.file(input.storageKey)
		const expires = Date.now() + this.config.ticketTtlSeconds * 1000
		// GCS enforces the exact byte count through x-goog-content-length-range; content-length alone
		// is not a signable header on GCS the way it is on S3 (flag 6).
		const requiredHeaders: Record<string, string> = {
			"content-type": input.mime,
			"content-length": String(input.bytes),
			"x-goog-content-length-range": `${input.bytes},${input.bytes}`,
		}
		// Create-only precondition: a replayed URL can't destroy a settled Revision's bytes.
		if (this.config.createOnly || input.createOnly) requiredHeaders["x-goog-if-generation-match"] = "0"
		// content-type is signed through contentType below.
		const extensionHeaders = { ...requiredHeaders }
		delete extensionHeaders["content-type"]
		const [url] = await file.getSignedUrl({
			version: "v4",
			action: "write",
			expires,
			contentType: input.mime,
			extensionHeaders,
		})
		return {
			url,
			storageKey: input.storageKey,
			expiresInSeconds: this.config.ticketTtlSeconds,
			requiredHeaders,
		}
	}
}
