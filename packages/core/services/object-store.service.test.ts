import { describe, expect, it } from "vitest"

import { InMemoryObjectStore } from "./object-store.service"

import type { Readable } from "node:stream"

describe("InMemoryObjectStore", () => {
	it("returns the text and the stream for a stored key", async () => {
		const store = new InMemoryObjectStore({ "artifacts/v1.md": "# plan" })

		expect(await store.getText("artifacts/v1.md")).toBe("# plan")
		const object = await store.getStream("artifacts/v1.md")
		expect(object.contentLength).toBe(6)
		expect(await streamToString(object.stream)).toBe("# plan")
	})

	it("throws ObjectNotFoundError for a key it does not hold", async () => {
		const store = new InMemoryObjectStore({})
		await expect(store.getText("artifacts/missing.md")).rejects.toThrow("object not found")
	})

	it("head returns bytes and mime after put", async () => {
		const store = new InMemoryObjectStore({})
		await store.put({ key: "artifacts/v1.md", bytes: new TextEncoder().encode("# plan"), mime: "text/markdown" })
		expect(await store.head("artifacts/v1.md")).toEqual({ bytes: 6, mime: "text/markdown" })
	})

	it("head returns null for a missing key", async () => {
		const store = new InMemoryObjectStore({})
		expect(await store.head("artifacts/missing.md")).toBeNull()
	})

	it("delete then getText rejects with ObjectNotFoundError", async () => {
		const store = new InMemoryObjectStore({ "artifacts/v1.md": "# plan" })
		await store.delete("artifacts/v1.md")
		await expect(store.getText("artifacts/v1.md")).rejects.toThrow("object not found")
	})

	it("delete of a missing key resolves", async () => {
		const store = new InMemoryObjectStore({})
		await expect(store.delete("artifacts/missing.md")).resolves.toBeUndefined()
	})
})

const streamToString = async (stream: Readable): Promise<string> => {
	const chunks: Buffer[] = []
	for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
	return Buffer.concat(chunks).toString("utf8")
}
