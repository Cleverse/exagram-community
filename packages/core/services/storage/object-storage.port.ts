export interface UploadTicket {
	url: string
	storageKey: string
	expiresInSeconds: number
	requiredHeaders: Record<string, string>
}

export interface StoredObject {
	bytes: number
	mime: string
	sha256: string
	body: Buffer
}

export interface ObjectStorage {
	/** Presigns a PUT with the byte count signed in, so the uploader cannot substitute a different size. */
	createUploadTicket(input: {
		storageKey: string
		mime: string
		bytes: number
		createOnly?: boolean
	}): Promise<UploadTicket>
	/** Re-reads the stored object and measures it; returns null when nothing was uploaded to that key. */
	readVerified(input: { storageKey: string; maxBytes: number }): Promise<StoredObject | null>
	/** Writes bytes directly to a key. Only a server-side copy (Duplicate) calls this; a client upload always goes through the presigned ticket instead. */
	put(input: { storageKey: string; bytes: Buffer; mime: string }): Promise<void>
	/** Whether an object is at the key, without reading its body. */
	exists(storageKey: string): Promise<boolean>
	/** Best-effort cleanup for a copy that never finished writing its Revision row. */
	delete(storageKey: string): Promise<void>
}
