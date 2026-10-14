import { createHash } from "node:crypto"

import type { ObjectStore } from "@exagram/core/services/object-store.service"

export interface BodyStore {
	/**
	 * The body as text, or null when the stored bytes aren't the ones the Revision recorded: a presigned
	 * PUT can overwrite an object until its ticket expires.
	 */
	read(storageKey: string, expected: { sha256: string; bytes: number }): Promise<string | null>
	write(input: { storageKey: string; body: string; mime: string }): Promise<void>
	/** Undoes a half-finished upload; a missing key is not an error. */
	remove(storageKey: string): Promise<void>
}

export function createBodyStore(objectStore: ObjectStore): BodyStore {
	return {
		async read(storageKey, expected) {
			const bytes = Buffer.from(await objectStore.get(storageKey))
			if (bytes.byteLength !== expected.bytes) return null
			if (createHash("sha256").update(bytes).digest("hex") !== expected.sha256) return null
			return bytes.toString("utf8")
		},
		async write({ storageKey, body, mime }) {
			await objectStore.put({ key: storageKey, bytes: Buffer.from(body, "utf-8"), mime })
		},
		async remove(storageKey) {
			await objectStore.delete(storageKey)
		},
	}
}
