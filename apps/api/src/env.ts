import { DbEnvSchema } from "@exagram/core/repository/postgres/db.env"
import { parseStorageEnv } from "@exagram/core/services/storage/storage.env"
import { secretEnv, unsetIfEmpty } from "@exagram/core/utils/env"
import { z } from "zod"

import type { StorageEnv } from "@exagram/core/services/storage/storage.env"

import { parseEditionEnv, type EditionEnv } from "./edition.env"

const CLIENT_IP_HEADER_HINT =
	"set it to the header your proxy overwrites with the client address (cf-connecting-ip behind Cloudflare, x-real-ip behind the bundled Caddy), or none when nothing sits in front of the api"

// A header name, or `none` for the TCP peer (null). No default: a silent one would put every user
// behind a proxy into the proxy's rate-limit bucket.
const ClientIpHeader = z
	.string({ error: `CLIENT_IP_HEADER is required: ${CLIENT_IP_HEADER_HINT}` })
	.transform((value, ctx) => {
		const name = value.trim().toLowerCase()
		if (name === "none") return null
		// Proxies append to it rather than overwrite it, so a caller controls its value.
		if (name === "x-forwarded-for") {
			ctx.addIssue({
				code: "custom",
				message: `CLIENT_IP_HEADER cannot be x-forwarded-for, callers can append to it: ${CLIENT_IP_HEADER_HINT}`,
			})
			return z.NEVER
		}
		if (!/^[a-z0-9-]+$/.test(name)) {
			ctx.addIssue({
				code: "custom",
				message: `CLIENT_IP_HEADER must be a header name or none: ${CLIENT_IP_HEADER_HINT}`,
			})
			return z.NEVER
		}
		return name
	})

const OptionalEnvString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional())

// http(s), dotted-alphanumeric host, optional :port. Rejects what a bare URL round-trip lets
// through: "a.com;connect-src" (directive injection), "*.a.com", other schemes.
const ORIGIN_SHAPE = /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i

/**
 * The whole environment of `apps/api`. Later tasks add keys to this object rather than a second schema
 * (`preflight.env.ts` has its own), and no module reads `process.env` directly.
 */
const BaseEnvSchema = z
	.object({
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		HTTP_PORT: z.coerce.number().int().min(0).default(3000),
		LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
		SHUTDOWN_TIMEOUT_SEC: z.coerce.number().int().positive().default(30),

		API_ORIGIN: z.url().default("http://localhost:3000"),
		WEB_ORIGIN: z.url().default("http://localhost:5173"),
		USERCONTENT_ORIGIN: z.url().default("http://localhost:3002"),
		// Where Link pages render: the api itself in Cloud (`apps/api/src/plugins/link-page.route.ts`),
		// same origin as the web app in Self-hosted. Defaults from WEB_ORIGIN, filled below.
		LINK_ORIGIN: z.url().optional(),
		GOOGLE_CLIENT_ID: OptionalEnvString,
		GOOGLE_CLIENT_SECRET: OptionalEnvString,

		CLIENT_IP_HEADER: ClientIpHeader,

		...DbEnvSchema.shape,

		// The cookie's name is a constant in `session.plugin.ts`, not a knob: see the note there.
		SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1_209_600),
		SESSION_COOKIE_SECURE: z.stringbool().default(false),
		UPLOAD_TICKET_TTL_SECONDS: z.coerce.number().int().positive().max(86_400).default(300),
		// Signs filesystem-driver upload tickets; required only for that driver. Its own key, so a leak
		// of USERCONTENT_TOKEN_SECRET can't mint uploads, nor this one usercontent tokens.
		UPLOAD_TOKEN_SECRET: unsetIfEmpty(secretEnv("UPLOAD_TOKEN_SECRET").optional()),

		// The only value with no default: a signing key that falls back to a constant is not a key.
		USERCONTENT_TOKEN_SECRET: secretEnv("USERCONTENT_TOKEN_SECRET"),
		USERCONTENT_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(300),

		UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(20_971_520),

		OIDC_COOKIE_KEYS: secretEnv("OIDC_COOKIE_KEYS"),
		OIDC_JWKS: z.string().min(1),
		MCP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
	})
	.refine(
		({ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET }) =>
			(GOOGLE_CLIENT_ID !== undefined) === (GOOGLE_CLIENT_SECRET !== undefined),
		{
			message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
			path: ["GOOGLE_CLIENT_ID"],
		},
	)
	.transform((env, ctx) => {
		const usercontentOrigin = env.USERCONTENT_ORIGIN.replace(/\/+$/, "")
		const shapeOk = ORIGIN_SHAPE.test(usercontentOrigin)
		let roundTripOk = false
		try {
			roundTripOk = new URL(usercontentOrigin).origin === usercontentOrigin
		} catch {
			roundTripOk = false
		}
		if (!shapeOk || !roundTripOk) {
			ctx.addIssue({
				code: "custom",
				path: ["USERCONTENT_ORIGIN"],
				message: `invalid origin: ${usercontentOrigin}`,
			})
			return z.NEVER
		}
		return {
			...env,
			USERCONTENT_ORIGIN: usercontentOrigin,
			WEB_ORIGIN: env.WEB_ORIGIN.replace(/\/+$/, ""),
			LINK_ORIGIN: (env.LINK_ORIGIN ?? env.WEB_ORIGIN).replace(/\/+$/, ""),
		}
	})

export type Env = z.infer<typeof BaseEnvSchema> & EditionEnv & StorageEnv

export function parseEnv(source: NodeJS.ProcessEnv): Env {
	const parsed = BaseEnvSchema.safeParse(source)
	if (!parsed.success) {
		throw new Error(`invalid environment: ${JSON.stringify(z.flattenError(parsed.error).fieldErrors)}`)
	}
	const edition = parseEditionEnv(source)
	const storage = parseStorageEnv(source)
	if (storage.STORAGE_DRIVER === "filesystem" && parsed.data.UPLOAD_TOKEN_SECRET === undefined) {
		throw new Error(
			`invalid environment: ${JSON.stringify({ UPLOAD_TOKEN_SECRET: ["required when STORAGE_DRIVER=filesystem"] })}`,
		)
	}
	return { ...parsed.data, ...edition, ...storage }
}

export const ENV = parseEnv(process.env)
