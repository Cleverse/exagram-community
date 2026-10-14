import { isAbsolute } from "node:path"

import { z } from "zod"

import { unsetIfEmpty } from "../../utils/env"

export interface GcsServiceAccountCredentials {
	client_email: string
	private_key: string
}

export function decodeGcsServiceAccountKey(base64: string): GcsServiceAccountCredentials {
	let parsed: unknown
	try {
		parsed = JSON.parse(Buffer.from(base64, "base64").toString("utf8"))
	} catch {
		throw new Error("GCS_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON")
	}
	const record = parsed as Record<string, unknown>
	if (typeof record.client_email !== "string" || typeof record.private_key !== "string") {
		throw new Error("GCS_SERVICE_ACCOUNT_KEY_BASE64 must decode to JSON with client_email and private_key")
	}
	return { client_email: record.client_email, private_key: record.private_key }
}

// An S3_HTTP_HOSTS entry may name an IPv6 host with or without brackets; compare both sides bare.
const bareHost = (host: string): string =>
	host
		.trim()
		.toLowerCase()
		.replace(/^\[(.*)\]$/, "$1")

// `URL.hostname` lowercases and keeps IPv6 brackets.
const isLoopbackHost = (hostname: string): boolean =>
	hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname)

const S3StorageEnvSchema = z
	.object({
		STORAGE_DRIVER: z.literal("s3"),
		// Unset means the SDK's own endpoint for S3_REGION (AWS).
		S3_ENDPOINT: unsetIfEmpty(z.url().optional()),
		// The endpoint presigned URLs are addressed to, when the browser can't reach S3_ENDPOINT.
		S3_PUBLIC_ENDPOINT: unsetIfEmpty(z.url().optional()),
		S3_REGION: unsetIfEmpty(z.string().min(1).default("us-east-1")),
		S3_BUCKET: unsetIfEmpty(z.string().min(1).default("exagram")),
		// Both or neither; neither means the SDK's default credential chain (instance role, IRSA, env).
		S3_ACCESS_KEY_ID: unsetIfEmpty(z.string().min(1).optional()),
		S3_SECRET_ACCESS_KEY: unsetIfEmpty(z.string().min(1).optional()),
		S3_FORCE_PATH_STYLE: unsetIfEmpty(z.stringbool().optional()),
		// Hosts S3_ENDPOINT may reach over plain http besides loopback: exact names, comma-separated.
		S3_HTTP_HOSTS: unsetIfEmpty(z.string().optional()),
	})
	.superRefine((value, ctx) => {
		if ((value.S3_ACCESS_KEY_ID === undefined) !== (value.S3_SECRET_ACCESS_KEY === undefined)) {
			ctx.addIssue({
				code: "custom",
				path: ["S3_ACCESS_KEY_ID"],
				message: "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together",
			})
		}
		if (value.S3_ENDPOINT !== undefined) {
			const url = new URL(value.S3_ENDPOINT)
			const httpHosts = (value.S3_HTTP_HOSTS ?? "").split(",").map(bareHost)
			if (url.protocol === "http:" && !isLoopbackHost(url.hostname) && !httpHosts.includes(bareHost(url.hostname))) {
				ctx.addIssue({
					code: "custom",
					path: ["S3_ENDPOINT"],
					message: `S3_ENDPOINT may use http:// only for a loopback host or one listed in S3_HTTP_HOSTS; ${url.hostname} is neither`,
				})
			} else if (url.protocol !== "http:" && url.protocol !== "https:") {
				ctx.addIssue({ code: "custom", path: ["S3_ENDPOINT"], message: "S3_ENDPOINT must be an http(s) URL" })
			}
		}
		if (value.S3_PUBLIC_ENDPOINT !== undefined) {
			// Browsers block a plain-http upload from an https page, so S3_HTTP_HOSTS does not apply here.
			const url = new URL(value.S3_PUBLIC_ENDPOINT)
			if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
				ctx.addIssue({
					code: "custom",
					path: ["S3_PUBLIC_ENDPOINT"],
					message: `S3_PUBLIC_ENDPOINT must use https:// unless its host is loopback; ${url.hostname} is not`,
				})
			}
		}
	})
	.transform((value) => ({
		...value,
		// A custom endpoint is usually MinIO-like (path-style); AWS itself wants virtual-hosted style.
		S3_FORCE_PATH_STYLE: value.S3_FORCE_PATH_STYLE ?? value.S3_ENDPOINT !== undefined,
	}))

const GcsStorageEnvSchema = z
	.object({
		STORAGE_DRIVER: z.literal("gcs"),
		GCS_BUCKET: unsetIfEmpty(z.string().min(1)),
		GCS_PROJECT_ID: unsetIfEmpty(z.string().min(1).optional()),
		GCS_SERVICE_ACCOUNT_KEY_BASE64: unsetIfEmpty(z.string().min(1).optional()),
		// Governs browser tickets only (needs the bucket's CORS to allow x-goog-if-generation-match, so opt-in); MCP tickets are always create-only.
		GCS_CREATE_ONLY_UPLOADS: unsetIfEmpty(z.stringbool().default(false)),
	})
	.superRefine((value, ctx) => {
		if (value.GCS_SERVICE_ACCOUNT_KEY_BASE64 === undefined) return
		try {
			decodeGcsServiceAccountKey(value.GCS_SERVICE_ACCOUNT_KEY_BASE64)
		} catch (error) {
			ctx.addIssue({
				code: "custom",
				path: ["GCS_SERVICE_ACCOUNT_KEY_BASE64"],
				message: error instanceof Error ? error.message : "invalid GCS_SERVICE_ACCOUNT_KEY_BASE64",
			})
		}
	})

const FilesystemStorageEnvSchema = z.object({
	STORAGE_DRIVER: z.literal("filesystem"),
	// Absolute, because api, worker and usercontent run with different working directories and a
	// relative path would silently give each its own store.
	STORAGE_DIR: unsetIfEmpty(
		z
			.string({ error: "STORAGE_DIR is required when STORAGE_DRIVER=filesystem" })
			.refine(isAbsolute, { error: "STORAGE_DIR must be an absolute path" }),
	),
})

export const StorageEnvSchema = z.preprocess(
	(raw) => {
		const source = raw as Record<string, unknown>
		const driver = source.STORAGE_DRIVER
		return { ...source, STORAGE_DRIVER: driver === undefined || driver === "" ? "s3" : driver }
	},
	z.discriminatedUnion("STORAGE_DRIVER", [S3StorageEnvSchema, GcsStorageEnvSchema, FilesystemStorageEnvSchema]),
)

export type StorageEnv = z.infer<typeof StorageEnvSchema>

export function parseStorageEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): StorageEnv {
	const parsed = StorageEnvSchema.safeParse(source)
	if (!parsed.success) {
		throw new Error(`invalid storage environment: ${JSON.stringify(z.flattenError(parsed.error).fieldErrors)}`)
	}
	return parsed.data
}
