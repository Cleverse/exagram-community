import { Readable } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import { ObjectNotFoundError } from "../object-store.service"

import { GcsObjectStore } from "./gcs.object-store"

import type { Bucket, File } from "@google-cloud/storage"

const fakeBucket = (file: Partial<File>): Bucket => ({ file: vi.fn().mockReturnValue(file) }) as unknown as Bucket

describe("GcsObjectStore", () => {
	it("maps a 404 on getStream to ObjectNotFoundError", async () => {
		const file: Partial<File> = { getMetadata: vi.fn().mockRejectedValue({ code: 404 }) }
		const store = new GcsObjectStore(fakeBucket(file))

		await expect(store.getStream("missing")).rejects.toBeInstanceOf(ObjectNotFoundError)
	})

	it("getStream returns the file's read stream with contentLength from metadata", async () => {
		const stream = Readable.from(["hi"])
		const file: Partial<File> = {
			getMetadata: vi.fn().mockResolvedValue([{ size: "6", contentType: "text/markdown" }]),
			createReadStream: vi.fn().mockReturnValue(stream),
		}
		const store = new GcsObjectStore(fakeBucket(file))

		const object = await store.getStream("k")

		expect(object.stream).toBe(stream)
		expect(object.contentLength).toBe(6)
	})

	it("put passes contentType and uses resumable:false", async () => {
		const save = vi.fn().mockResolvedValue(undefined)
		const store = new GcsObjectStore(fakeBucket({ save }))

		await store.put({ key: "k", bytes: new TextEncoder().encode("hi"), mime: "text/plain" })

		expect(save).toHaveBeenCalledWith(Buffer.from("hi"), { contentType: "text/plain", resumable: false })
	})

	it("delete uses ignoreNotFound", async () => {
		const remove = vi.fn().mockResolvedValue(undefined)
		const store = new GcsObjectStore(fakeBucket({ delete: remove }))

		await store.delete("k")

		expect(remove).toHaveBeenCalledWith({ ignoreNotFound: true })
	})

	it("head maps size and contentType", async () => {
		const file: Partial<File> = {
			getMetadata: vi.fn().mockResolvedValue([{ size: "42", contentType: "application/pdf" }]),
		}
		const store = new GcsObjectStore(fakeBucket(file))

		expect(await store.head("k")).toEqual({ bytes: 42, mime: "application/pdf" })
	})

	it("head returns null for a missing key", async () => {
		const file: Partial<File> = { getMetadata: vi.fn().mockRejectedValue({ code: 404 }) }
		const store = new GcsObjectStore(fakeBucket(file))

		expect(await store.head("k")).toBeNull()
	})
})
