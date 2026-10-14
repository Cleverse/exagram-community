import { ObjectNotFoundError } from "../object-store.service"

import type { ObjectStore, ObjectStream } from "../object-store.service"
import type { Bucket } from "@google-cloud/storage"

const isNotFound = (error: unknown): boolean => (error as { code?: number })?.code === 404

export class GcsObjectStore implements ObjectStore {
	constructor(private readonly bucket: Bucket) {}

	async getStream(key: string): Promise<ObjectStream> {
		const file = this.bucket.file(key)
		let metadata: { size?: string | number }
		try {
			;[metadata] = await file.getMetadata()
		} catch (error) {
			if (isNotFound(error)) throw new ObjectNotFoundError()
			throw error
		}
		return {
			stream: file.createReadStream(),
			contentLength: metadata.size !== undefined ? Number(metadata.size) : null,
		}
	}

	async getText(key: string): Promise<string> {
		return Buffer.from(await this.get(key)).toString("utf8")
	}

	async get(key: string): Promise<Uint8Array> {
		const object = await this.getStream(key)
		const chunks: Buffer[] = []
		for await (const chunk of object.stream) chunks.push(Buffer.from(chunk as Buffer))
		return new Uint8Array(Buffer.concat(chunks))
	}

	async put(input: { key: string; bytes: Uint8Array; mime: string }): Promise<void> {
		await this.bucket.file(input.key).save(Buffer.from(input.bytes), { contentType: input.mime, resumable: false })
	}

	async head(key: string): Promise<{ bytes: number; mime: string } | null> {
		try {
			const [metadata] = await this.bucket.file(key).getMetadata()
			return { bytes: Number(metadata.size ?? 0), mime: metadata.contentType ?? "application/octet-stream" }
		} catch (error) {
			if (isNotFound(error)) return null
			throw error
		}
	}

	async delete(key: string): Promise<void> {
		await this.bucket.file(key).delete({ ignoreNotFound: true })
	}
}
