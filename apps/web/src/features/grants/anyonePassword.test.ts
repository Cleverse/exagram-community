import { describe, expect, it } from "vitest"

import { generatePassword, ANYONE_PASSWORD_ALPHABET } from "./anyonePassword"

describe("generatePassword", () => {
	it("writes three groups of four, joined by hyphens", () => {
		expect(generatePassword()).toMatch(/^[^-]{4}-[^-]{4}-[^-]{4}$/)
	})

	it("never uses a character that reads as another", () => {
		const seen = new Set<string>()
		for (let n = 0; n < 400; n++) for (const character of generatePassword().replaceAll("-", "")) seen.add(character)
		expect([...seen].filter((character) => !ANYONE_PASSWORD_ALPHABET.includes(character))).toEqual([])
		for (const lookAlike of "0O1lIiLo") expect(seen.has(lookAlike)).toBe(false)
		// The sample is wide enough to have drawn from most of the alphabet, so the check above is not vacuous.
		expect(seen.size).toBeGreaterThan(ANYONE_PASSWORD_ALPHABET.length * 0.9)
	})

	it("throws away the bytes that would favour the first characters", () => {
		const biased = 256 - (256 % ANYONE_PASSWORD_ALPHABET.length)
		// The top of the byte range comes first. A plain remainder map would turn it into early characters.
		const bytes = [255, biased, biased + 1, ...Array.from({ length: 12 }, (_, index) => index)]
		const password = generatePassword((buffer) => {
			buffer.set(bytes.slice(0, buffer.length))
			return buffer
		})
		const [first, second, third] = [0, 4, 8].map((at) => ANYONE_PASSWORD_ALPHABET.slice(at, at + 4))
		expect(password).toBe(`${first}-${second}-${third}`)
	})

	it("draws a different password each time", () => {
		expect(new Set(Array.from({ length: 20 }, () => generatePassword())).size).toBe(20)
	})
})
