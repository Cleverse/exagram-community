import { describe, expect, it } from "vitest"

import { InMemoryObjectStore } from "../object-store.service"

import { VerifiedUploadStorage } from "./verified-upload.storage"

import type { UploadTicket } from "./object-storage.port"
import type { UploadSigner } from "./upload-signer.port"

const noopSigner: UploadSigner = {
	createUploadTicket: (): Promise<UploadTicket> =>
		Promise.resolve({ url: "https://signed", storageKey: "k", expiresInSeconds: 300, requiredHeaders: {} }),
}

describe("VerifiedUploadStorage.readVerified", () => {
	it("returns null when the key is missing", async () => {
		const storage = new VerifiedUploadStorage(new InMemoryObjectStore({}), noopSigner)
		expect(await storage.readVerified({ storageKey: "bodies/missing", maxBytes: 100 })).toBeNull()
	})

	it("returns null when head.bytes is 0", async () => {
		const objectStore = new InMemoryObjectStore({})
		await objectStore.put({ key: "bodies/empty", bytes: new Uint8Array(), mime: "text/plain" })
		const storage = new VerifiedUploadStorage(objectStore, noopSigner)
		expect(await storage.readVerified({ storageKey: "bodies/empty", maxBytes: 100 })).toBeNull()
	})

	it("returns null when head.bytes is over maxBytes", async () => {
		const objectStore = new InMemoryObjectStore({})
		await objectStore.put({ key: "bodies/big", bytes: new TextEncoder().encode("0123456789"), mime: "text/plain" })
		const storage = new VerifiedUploadStorage(objectStore, noopSigner)
		expect(await storage.readVerified({ storageKey: "bodies/big", maxBytes: 5 })).toBeNull()
	})

	it("returns bytes, mime, sha256 and body otherwise", async () => {
		const objectStore = new InMemoryObjectStore({})
		const bytes = new TextEncoder().encode("# plan")
		await objectStore.put({ key: "bodies/v1", bytes, mime: "text/markdown" })
		const storage = new VerifiedUploadStorage(objectStore, noopSigner)

		const result = await storage.readVerified({ storageKey: "bodies/v1", maxBytes: 100 })

		expect(result).not.toBeNull()
		expect(result?.bytes).toBe(6)
		expect(result?.mime).toBe("text/markdown")
		expect(result?.body.toString("utf8")).toBe("# plan")
		expect(result?.sha256).toMatch(/^[0-9a-f]{64}$/)
	})
})

describe("VerifiedUploadStorage.exists", () => {
	it("says whether an object is at the key", async () => {
		const objectStore = new InMemoryObjectStore({})
		await objectStore.put({ key: "bodies/v1", bytes: new TextEncoder().encode("x"), mime: "text/plain" })
		const storage = new VerifiedUploadStorage(objectStore, noopSigner)

		expect(await storage.exists("bodies/v1")).toBe(true)
		expect(await storage.exists("bodies/missing")).toBe(false)
	})
})
