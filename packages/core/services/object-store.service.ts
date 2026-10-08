import { Readable } from "node:stream"

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

import type { S3Client } from "@aws-sdk/client-s3"

/** Named for the stream it carries; P2-13's `StoredObject` is the upload side and stays distinct. */
export interface ObjectStream {
	stream: Readable
	contentLength: number | null
}

export class ObjectNotFoundError extends Error {
	constructor() {
		super("object not found")
		this.name = "ObjectNotFoundError"
	}
}

export interface ObjectStore {
	getStream(key: string): Promise<ObjectStream>
	getText(key: string): Promise<string>
	get(key: string): Promise<Uint8Array>
	put(input: { key: string; bytes: Uint8Array; mime: string }): Promise<void>
	head(key: string): Promise<{ bytes: number; mime: string } | null>
	delete(key: string): Promise<void>
}

/** Bodies are content-addressed, so two identical revisions share one object. */
export const bodyKey = (sha256: string) => `bodies/${sha256}`

const isNotFound = (error: unknown): boolean => {
	const name = (error as { name?: string })?.name
	const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
	return name === "NotFound" || name === "NoSuchKey" || status === 404
}

export class S3ObjectStore implements ObjectStore {
	constructor(
		private readonly client: S3Client,
		private readonly bucket: string,
	) {}

	async getStream(key: string): Promise<ObjectStream> {
		const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => null)
		if (result?.Body === undefined || result.Body === null) throw new ObjectNotFoundError()
		return { stream: result.Body as Readable, contentLength: result.ContentLength ?? null }
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
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: input.key,
				Body: input.bytes,
				ContentType: input.mime,
			}),
		)
	}

	async head(key: string): Promise<{ bytes: number; mime: string } | null> {
		try {
			const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
			return { bytes: result.ContentLength ?? 0, mime: result.ContentType ?? "application/octet-stream" }
		} catch (error) {
			if (isNotFound(error)) return null
			throw error
		}
	}

	async delete(key: string): Promise<void> {
		await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
	}
}

export class InMemoryObjectStore implements ObjectStore {
	private readonly mimes = new Map<string, string>()

	constructor(private readonly objects: Record<string, string>) {}

	async get(key: string): Promise<Uint8Array> {
		return new TextEncoder().encode(await this.getText(key))
	}

	put(input: { key: string; bytes: Uint8Array; mime: string }): Promise<void> {
		this.objects[input.key] = new TextDecoder().decode(input.bytes)
		this.mimes.set(input.key, input.mime)
		return Promise.resolve()
	}

	getStream(key: string): Promise<ObjectStream> {
		const body = this.objects[key]
		if (body === undefined) return Promise.reject(new ObjectNotFoundError())
		return Promise.resolve({
			stream: Readable.from([Buffer.from(body, "utf8")]),
			contentLength: Buffer.byteLength(body, "utf8"),
		})
	}

	getText(key: string): Promise<string> {
		const body = this.objects[key]
		if (body === undefined) return Promise.reject(new ObjectNotFoundError())
		return Promise.resolve(body)
	}

	head(key: string): Promise<{ bytes: number; mime: string } | null> {
		const body = this.objects[key]
		if (body === undefined) return Promise.resolve(null)
		return Promise.resolve({
			bytes: Buffer.byteLength(body, "utf8"),
			mime: this.mimes.get(key) ?? "application/octet-stream",
		})
	}

	delete(key: string): Promise<void> {
		delete this.objects[key]
		this.mimes.delete(key)
		return Promise.resolve()
	}
}
