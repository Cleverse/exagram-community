import { z } from "zod"

import { unsetIfEmpty } from "../../utils/env"

import { resolveDbConnection } from "./db-tls"

import type { ConnectionOptions } from "node:tls"

export const DbEnvSchema = z.object({
	DATABASE_URL: z.string().min(1),
	DATABASE_MAX_CONNECTIONS: unsetIfEmpty(z.coerce.number().int().min(2).default(10)),
	DATABASE_PLAINTEXT_HOSTS: unsetIfEmpty(
		z
			.string()
			.default("")
			.transform((value) =>
				value
					.split(",")
					.map((host) => host.trim())
					.filter((host) => host !== ""),
			),
	),
	DATABASE_CA_SERVER_SPECIFIC: unsetIfEmpty(z.stringbool().default(false)),
})

export type DbEnv = z.infer<typeof DbEnvSchema>

export interface DbConnection {
	url: string
	ssl: false | ConnectionOptions
	max: number
	warnings: string[]
}

/** Resolves `DATABASE_URL` for the app pools; throws `DbConfigError` at boot and hands each warning to `warn`. */
export function resolveDbEnv(
	env: DbEnv,
	warn: (message: string) => void = console.warn,
	readFile?: (path: string) => string,
): DbConnection {
	const { url, ssl, warnings } = resolveDbConnection(env.DATABASE_URL, {
		plaintextHosts: env.DATABASE_PLAINTEXT_HOSTS,
		caServerSpecific: env.DATABASE_CA_SERVER_SPECIFIC,
		params: "app",
		readFile,
	})
	for (const warning of warnings) warn(warning)
	return { url, ssl, max: env.DATABASE_MAX_CONNECTIONS, warnings }
}
