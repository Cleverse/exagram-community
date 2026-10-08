import { DbEnvSchema } from "@exagram/core/repository/postgres/db.env"
import { parseStorageEnv } from "@exagram/core/services/storage/storage.env"
import { secretEnv, unsetIfEmpty } from "@exagram/core/utils/env"
import { z } from "zod"

import type { StorageEnv } from "@exagram/core/services/storage/storage.env"

import { isPemSigningKey, parseSigningJwks } from "./oauth/signing-keys"

/** A PEM RSA private key is parsed (and so fully checked); JWKS JSON gets a light structural check only: a non-empty `keys`, each entry a private key (`kty` and `d`). */
const signingJwks = z.string().superRefine((raw, ctx) => {
	if (isPemSigningKey(raw)) {
		try {
			parseSigningJwks(raw)
		} catch (error) {
			ctx.addIssue({
				code: "custom",
				message: `${error instanceof Error ? error.message : "OIDC_JWKS is not a usable PEM key"}; run deploy/gen-secrets.sh to generate one`,
			})
		}
		return
	}
	let keys: unknown
	try {
		keys = (JSON.parse(raw) as { keys?: unknown } | null)?.keys
	} catch {
		keys = undefined
	}
	const isPrivateKey = (key: unknown) =>
		typeof key === "object" &&
		key !== null &&
		typeof (key as { kty?: unknown }).kty === "string" &&
		typeof (key as { d?: unknown }).d === "string"
	if (!Array.isArray(keys) || keys.length === 0 || !keys.every(isPrivateKey)) {
		ctx.addIssue({
			code: "custom",
			message:
				"OIDC_JWKS must be JSON with a non-empty keys array of private keys; run deploy/gen-secrets.sh to generate one",
		})
	}
})

/** The environment of `preflight.ts`, the one-shot `preflight` compose service: only the keys it checks. */
const PreflightEnvSchema = z.object({
	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
	...DbEnvSchema.omit({ DATABASE_MAX_CONNECTIONS: true }).shape,
	MIGRATE_DATABASE_URL: z.string().min(1),

	// The secrets api refuses to boot without, so a bad .env stops here before migrate runs.
	USERCONTENT_TOKEN_SECRET: secretEnv("USERCONTENT_TOKEN_SECRET"),
	OIDC_COOKIE_KEYS: secretEnv("OIDC_COOKIE_KEYS"),
	OIDC_JWKS: signingJwks,
	UPLOAD_TOKEN_SECRET: unsetIfEmpty(secretEnv("UPLOAD_TOKEN_SECRET").optional()),
})

export type PreflightEnv = z.infer<typeof PreflightEnvSchema> & StorageEnv

/** Not parsed at import, unlike the apps' `ENV`: preflight reports a bad environment as its own failure. */
export function parsePreflightEnv(source: NodeJS.ProcessEnv | Record<string, unknown> = process.env): PreflightEnv {
	const parsed = PreflightEnvSchema.safeParse(source)
	if (!parsed.success) {
		throw new Error(`invalid environment: ${JSON.stringify(z.flattenError(parsed.error).fieldErrors)}`)
	}
	const storage = parseStorageEnv(source)
	if (storage.STORAGE_DRIVER === "filesystem" && parsed.data.UPLOAD_TOKEN_SECRET === undefined) {
		throw new Error(
			`invalid environment: ${JSON.stringify({ UPLOAD_TOKEN_SECRET: ["required when STORAGE_DRIVER=filesystem"] })}`,
		)
	}
	return { ...parsed.data, ...storage }
}

/** The key that tells an `.env` from the MinIO-based layout apart (its gen-secrets always set it); read before the full schema so the refusal is the only error. */
const LegacyLayoutSchema = z.object({
	S3_HOST: unsetIfEmpty(z.string().optional()),
})

/** Why `source` is an `.env` generated for the old bundled-MinIO layout, or null. */
export function legacyLayoutReason(source: NodeJS.ProcessEnv | Record<string, unknown> = process.env): string | null {
	const parsed = LegacyLayoutSchema.safeParse(source)
	if (!parsed.success) return null
	if (parsed.data.S3_HOST !== undefined) return "S3_HOST is set"
	return null
}
