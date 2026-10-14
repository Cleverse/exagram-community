import { sha256Hex } from "../../utils/digest"

import type { ObjectStore } from "../object-store.service"
import type { ObjectStorage, StoredObject, UploadTicket } from "./object-storage.port"
import type { UploadSigner } from "./upload-signer.port"

export class VerifiedUploadStorage implements ObjectStorage {
	constructor(
		private readonly objectStore: ObjectStore,
		private readonly signer: UploadSigner,
	) {}

	createUploadTicket(input: {
		storageKey: string
		mime: string
		bytes: number
		createOnly?: boolean
	}): Promise<UploadTicket> {
		return this.signer.createUploadTicket(input)
	}

	async readVerified(input: { storageKey: string; maxBytes: number }): Promise<StoredObject | null> {
		const head = await this.objectStore.head(input.storageKey)
		if (head === null) return null
		if (head.bytes <= 0 || head.bytes > input.maxBytes) return null

		const body = Buffer.from(await this.objectStore.get(input.storageKey))
		if (body.byteLength > input.maxBytes) return null

		return { bytes: body.byteLength, mime: head.mime, sha256: sha256Hex(body), body }
	}

	async put(input: { storageKey: string; bytes: Buffer; mime: string }): Promise<void> {
		await this.objectStore.put({ key: input.storageKey, bytes: input.bytes, mime: input.mime })
	}

	async exists(storageKey: string): Promise<boolean> {
		return (await this.objectStore.head(storageKey)) !== null
	}

	async delete(storageKey: string): Promise<void> {
		await this.objectStore.delete(storageKey)
	}
}
