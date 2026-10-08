import { generateKeyPairSync } from "node:crypto"

import { describe, expect, it } from "vitest"

import { parseSigningJwks, rsaThumbprint } from "./signing-keys"

const rsa = (modulusLength: number) => generateKeyPairSync("rsa", { modulusLength })
const pkcs8 = (key: ReturnType<typeof rsa>["privateKey"]) => key.export({ format: "pem", type: "pkcs8" }).toString()
const pkcs1 = (key: ReturnType<typeof rsa>["privateKey"]) => key.export({ format: "pem", type: "pkcs1" }).toString()

describe("rsaThumbprint", () => {
	it("reproduces the RFC 7638 section 3.1 example", () => {
		expect(
			rsaThumbprint({
				n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
				e: "AQAB",
			}),
		).toBe("NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs")
	})
})

describe("parseSigningJwks", () => {
	const { privateKey } = rsa(2048)

	function expectOneRsaKey(jwks: ReturnType<typeof parseSigningJwks>) {
		expect(jwks.keys).toHaveLength(1)
		const key = jwks.keys[0]!
		expect(key.kty).toBe("RSA")
		expect(typeof key.d).toBe("string")
		expect(key.kid).toBe(rsaThumbprint({ e: key.e!, n: key.n! }))
		expect(key.use).toBe("sig")
		expect(key.alg).toBe("RS256")
	}

	it("reads a PKCS#8 key", () => {
		expectOneRsaKey(parseSigningJwks(pkcs8(privateKey)))
	})

	it("reads a PKCS#1 key", () => {
		expectOneRsaKey(parseSigningJwks(pkcs1(privateKey)))
	})

	it("reads a PEM whose newlines were flattened to a literal backslash-n", () => {
		expectOneRsaKey(parseSigningJwks(pkcs8(privateKey).trim().replaceAll("\n", "\\n")))
	})

	it("reads a PEM with leading whitespace", () => {
		expectOneRsaKey(parseSigningJwks(`\n  \t${pkcs8(privateKey)}`))
	})

	it("returns JWKS JSON unchanged", () => {
		const json = '{"keys":[{"kty":"RSA","d":"x","kid":"k"}]}'
		expect(parseSigningJwks(json)).toEqual(JSON.parse(json))
		expect(parseSigningJwks('{"keys":[]}')).toEqual({ keys: [] })
	})

	const other = rsa(2048).privateKey
	const ec = generateKeyPairSync("ec", { namedCurve: "P-256" })
	it.each<[string, () => string, RegExp]>([
		["two blocks", () => pkcs8(privateKey) + pkcs8(other), /more than one PEM block.*JWKS JSON/],
		["an EC key", () => ec.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), /must be an RSA key/],
		["a 1024-bit key", () => pkcs8(rsa(1024).privateKey), /at least 2048 bits/],
		[
			"an encrypted key",
			() =>
				privateKey
					.export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase: "secret-passphrase" })
					.toString(),
			/encrypted/,
		],
		["a public key", () => rsa(2048).publicKey.export({ format: "pem", type: "spki" }).toString(), /PRIVATE KEY/],
		[
			"garbage after BEGIN",
			() => "-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----",
			/not a readable/,
		],
	])("rejects %s without echoing key material", (_name, make, message) => {
		let thrown: unknown
		try {
			parseSigningJwks(make())
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBeInstanceOf(Error)
		expect((thrown as Error).message).toMatch(message)
		expect((thrown as Error).message).not.toContain("MII")
	})
})
