import type { UploadTicket } from "./object-storage.port"

export interface UploadSigner {
	/** Presigns a PUT with the byte count signed in, so the uploader cannot substitute a different size. */
	createUploadTicket(input: {
		storageKey: string
		mime: string
		bytes: number
		createOnly?: boolean
	}): Promise<UploadTicket>
}
