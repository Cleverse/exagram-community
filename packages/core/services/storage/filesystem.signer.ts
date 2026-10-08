import { UploadTokenSigner } from "./filesystem.upload-token"

import type { UploadTicket } from "./object-storage.port"
import type { UploadSigner } from "./upload-signer.port"

export interface FilesystemSignerConfig {
	/** Origin the browser PUTs to; the api serves `/v1/uploads/:token` there. */
	uploadOrigin: string
	secret: string
	ticketTtlSeconds: number
}

export class FilesystemUploadSigner implements UploadSigner {
	private readonly tokens: UploadTokenSigner

	constructor(
		private readonly config: FilesystemSignerConfig,
		private readonly now: () => number = Date.now,
	) {
		this.tokens = new UploadTokenSigner(config.secret)
	}

	createUploadTicket(input: {
		storageKey: string
		mime: string
		bytes: number
		createOnly?: boolean
	}): Promise<UploadTicket> {
		const token = this.tokens.sign({
			storageKey: input.storageKey,
			bytes: input.bytes,
			mime: input.mime,
			expiresAt: this.now() + this.config.ticketTtlSeconds * 1000,
		})
		return Promise.resolve({
			url: `${this.config.uploadOrigin.replace(/\/+$/, "")}/v1/uploads/${token}`,
			storageKey: input.storageKey,
			expiresInSeconds: this.config.ticketTtlSeconds,
			// Content-type only: browsers drop a manually set content-length, and the route checks the size itself.
			requiredHeaders: { "content-type": input.mime },
		})
	}
}
