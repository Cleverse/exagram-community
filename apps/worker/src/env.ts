import { DbEnvSchema } from "@exagram/core/repository/postgres/db.env"
import { StorageEnvSchema } from "@exagram/core/services/storage/storage.env"
import { z } from "zod"

import { checkEditionEnv, editionDefaults, EditionEnvSchema } from "./edition.env"

const AppEnvSchema = z.object({
	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

	...DbEnvSchema.shape,

	PARSE_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
	REDACT_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
	WEB_ORIGIN: z.url(),
	LINK_ORIGIN: z.url().optional(),
})

const EnvSchema = z
	.preprocess(
		(raw) => {
			const source = raw as Record<string, unknown>
			if (source.NODE_ENV !== "production" && !source.WEB_ORIGIN) {
				return { ...source, WEB_ORIGIN: "http://localhost:5173" }
			}
			return source
		},
		z.intersection(z.intersection(AppEnvSchema, StorageEnvSchema), EditionEnvSchema).superRefine(checkEditionEnv),
	)
	.transform((env) => ({
		...env,
		WEB_ORIGIN: env.WEB_ORIGIN.replace(/\/+$/, ""),
		LINK_ORIGIN: (env.LINK_ORIGIN ?? env.WEB_ORIGIN).replace(/\/+$/, ""),
		...editionDefaults(env),
	}))

export type Env = z.infer<typeof EnvSchema>

export function parseEnv(source: NodeJS.ProcessEnv): Env {
	const parsed = EnvSchema.safeParse(source)
	if (!parsed.success) {
		throw new Error(`invalid environment: ${JSON.stringify(z.flattenError(parsed.error).fieldErrors)}`)
	}
	return parsed.data
}

export const ENV = parseEnv(process.env)
