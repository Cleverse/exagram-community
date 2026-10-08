import { createHash, createPrivateKey, type JsonWebKey } from "node:crypto"

const MIN_RSA_BITS = 2048

/** True when `raw` is a PEM block rather than JWKS JSON. */
export const isPemSigningKey = (raw: string): boolean => raw.trimStart().startsWith("-----BEGIN")

/** RFC 7638 JWK thumbprint of an RSA public key: SHA-256 over the members `e`, `kty`, `n` in that order. */
export function rsaThumbprint(jwk: { e: string; n: string }): string {
	const canonical = `{"e":${JSON.stringify(jwk.e)},"kty":"RSA","n":${JSON.stringify(jwk.n)}}`
	return createHash("sha256").update(canonical).digest("base64url")
}

function pemSigningKey(raw: string): JsonWebKey {
	const pem = raw.replaceAll("\\n", "\n").trim()
	const blocks = pem.match(/-----BEGIN [A-Z ]+-----/g) ?? []
	if (blocks.length !== 1) {
		throw new Error("OIDC_JWKS holds more than one PEM block; use JWKS JSON for several keys")
	}
	const label = /^-----BEGIN ([A-Z ]+)-----/.exec(pem)?.[1]
	if (label === "ENCRYPTED PRIVATE KEY" || /Proc-Type:\s*4,ENCRYPTED/.test(pem)) {
		throw new Error("OIDC_JWKS PEM key is encrypted; provide an unencrypted private key")
	}
	if (label !== "PRIVATE KEY" && label !== "RSA PRIVATE KEY") {
		throw new Error('OIDC_JWKS PEM block must be a "PRIVATE KEY" (PKCS#8) or "RSA PRIVATE KEY" (PKCS#1)')
	}
	let key: ReturnType<typeof createPrivateKey>
	try {
		key = createPrivateKey(pem)
	} catch {
		throw new Error("OIDC_JWKS PEM block is not a readable unencrypted private key")
	}
	if (key.asymmetricKeyType !== "rsa") {
		throw new Error("OIDC_JWKS PEM key must be an RSA key")
	}
	const bits = key.asymmetricKeyDetails?.modulusLength ?? 0
	if (bits < MIN_RSA_BITS) {
		throw new Error(`OIDC_JWKS RSA key must be at least ${MIN_RSA_BITS} bits`)
	}
	const jwk = key.export({ format: "jwk" })
	if (jwk.e === undefined || jwk.n === undefined) {
		throw new Error("OIDC_JWKS PEM key could not be converted to a JWK")
	}
	return { ...jwk, kid: rsaThumbprint({ e: jwk.e, n: jwk.n }), use: "sig", alg: "RS256" }
}

/** `OIDC_JWKS` is JWKS JSON, or one unencrypted PEM RSA private key (2048+ bits) that becomes a one-key set. */
export function parseSigningJwks(raw: string): { keys: JsonWebKey[] } {
	if (isPemSigningKey(raw)) return { keys: [pemSigningKey(raw)] }
	return JSON.parse(raw) as { keys: JsonWebKey[] }
}
