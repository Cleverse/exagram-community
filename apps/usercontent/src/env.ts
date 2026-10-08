import { DbEnvSchema } from "@exagram/core/repository/postgres/db.env"
import { StorageEnvSchema } from "@exagram/core/services/storage/storage.env"
import { secretEnv } from "@exagram/core/utils/env"
import { z } from "zod"

// http(s), dotted-alphanumeric host, optional :port. Rejects what a bare URL round-trip lets
// through: "a.com;connect-src" (directive injection), "*.a.com", other schemes.
const ORIGIN_SHAPE = /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i

const parseOrigin = (value: string, ctx: z.RefinementCtx): string | typeof z.NEVER => {
	// The URL round-trip alone accepts `;`-injection, wildcards and other schemes (see ORIGIN_SHAPE above);
	// the shape check is the actual gate, the round-trip just confirms a real URL.
	const shapeOk = ORIGIN_SHAPE.test(value)
	let roundTripOk = false
	try {
		roundTripOk = new URL(value).origin === value
	} catch {
		roundTripOk = false
	}
	if (!shapeOk || !roundTripOk) {
		ctx.addIssue({ code: "custom", message: `invalid origin: ${value}` })
		return z.NEVER
	}
	return value
}

const AppEnvSchema = z.object({
	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
	HTTP_PORT: z.coerce.number().int().min(0).default(3002),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
	SHUTDOWN_TIMEOUT_SEC: z.coerce.number().int().positive().default(30),

	...DbEnvSchema.shape,

	USERCONTENT_TOKEN_SECRET: secretEnv("USERCONTENT_TOKEN_SECRET"),

	USERCONTENT_FRAME_ANCESTORS: z
		.string()
		.min(1)
		.transform((value, ctx) => {
			const origins = value.split(",").map((origin) => origin.trim())
			for (const origin of origins) {
				if (parseOrigin(origin, ctx) === z.NEVER) return z.NEVER
			}
			return origins
		}),

	// This origin's own public origin. Unset in production disables the CDN proxy (ADR 0037).
	USERCONTENT_ORIGIN: z
		.string()
		.optional()
		.transform((value, ctx) => {
			const origin = value?.replace(/\/+$/, "")
			if (!origin) return undefined
			return parseOrigin(origin, ctx)
		}),
})

const RawEnvSchema = z.intersection(AppEnvSchema, StorageEnvSchema)

// Unset/empty only defaults outside production, to the vite dev origin (which also proxies the
// Link page's /l/*); production keeps failing closed. USERCONTENT_ORIGIN defaults to the dev
// listener outside production and stays unset in production.
const EnvSchema = z.preprocess((raw) => {
	let source = raw as Record<string, unknown>
	if (source.NODE_ENV !== "production") {
		if (!source.USERCONTENT_FRAME_ANCESTORS)
			source = { ...source, USERCONTENT_FRAME_ANCESTORS: "http://localhost:5173" }
		if (!source.USERCONTENT_ORIGIN) source = { ...source, USERCONTENT_ORIGIN: "http://localhost:3002" }
	}
	return source
}, RawEnvSchema)

export type Env = z.infer<typeof EnvSchema>

export function parseEnv(source: NodeJS.ProcessEnv): Env {
	const parsed = EnvSchema.safeParse(source)
	if (!parsed.success) {
		throw new Error(`invalid environment: ${JSON.stringify(z.flattenError(parsed.error).fieldErrors)}`)
	}
	return parsed.data
}

export const ENV = parseEnv(process.env)
