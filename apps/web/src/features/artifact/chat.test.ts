import { describe, expect, it } from "vitest"

import { parseChatBody } from "./chat"

describe("parseChatBody", () => {
	it("reads turn-shaped bodies", () => {
		expect(parseChatBody(JSON.stringify({ turns: [{ question: "hi", answer: "hello" }] }))).toEqual([
			{ question: "hi", answer: "hello" },
		])
	})

	it("pairs role-shaped messages into turns", () => {
		const body = JSON.stringify([
			{ role: "system", content: "ignored" },
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
			{ role: "assistant", content: "again" },
		])
		expect(parseChatBody(body)).toEqual([{ question: "hi", answer: "hello\n\nagain" }])
	})

	it("returns null when the body is not a conversation", () => {
		expect(parseChatBody("not json")).toBeNull()
		expect(parseChatBody(JSON.stringify({ nope: 1 }))).toBeNull()
	})
})
