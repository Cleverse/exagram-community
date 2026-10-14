import { describe, expect, it } from "vitest"

import { sha256Hex } from "./digest"

describe("sha256Hex", () => {
	it("matches the known digest of the empty buffer and of 'abc'", () => {
		expect(sha256Hex(Buffer.alloc(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
		expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
	})
})
