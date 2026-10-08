import { createHash } from "node:crypto"

import { InMemoryObjectStore } from "@exagram/core/services/object-store.service"
import { describe, expect, it } from "vitest"

import { createBodyStore } from "./body.store"

describe("createBodyStore", () => {
	it("round-trips bodies and removes a missing key", async () => {
		const bodyStore = createBodyStore(new InMemoryObjectStore({}))

		await bodyStore.write({ storageKey: "body-1", body: "hello", mime: "text/plain" })

		expect(await bodyStore.read("body-1", { sha256: digest("hello"), bytes: 5 })).toBe("hello")
		await expect(bodyStore.remove("missing")).resolves.toBeUndefined()
	})

	it("reads nothing when the stored bytes aren't the ones the Revision recorded", async () => {
		const bodyStore = createBodyStore(new InMemoryObjectStore({}))
		await bodyStore.write({ storageKey: "body-1", body: "overwritten", mime: "text/plain" })

		expect(await bodyStore.read("body-1", { sha256: digest("hello"), bytes: 11 })).toBeNull()
		expect(await bodyStore.read("body-1", { sha256: digest("overwritten"), bytes: 5 })).toBeNull()
	})
})

const digest = (text: string) => createHash("sha256").update(text, "utf-8").digest("hex")
