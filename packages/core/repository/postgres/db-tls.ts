import { readFileSync } from "node:fs"

import type { ConnectionOptions } from "node:tls"

/** Boot-time refusal of a database URL. Messages name the key, parameter or host, never the URL or password. */
export class DbConfigError extends Error {
	override name = "DbConfigError"
}

export interface ResolveDbConnectionOptions {
	/** Hosts allowed without TLS besides loopback (`DATABASE_PLAINTEXT_HOSTS`), matched exactly. */
	plaintextHosts: string[]
	/** Operator's word that `sslrootcert` names a CA belonging to this one server (`DATABASE_CA_SERVER_SPECIFIC`). */
	caServerSpecific: boolean
	params: "app" | "migrate"
	readFile?: (path: string) => string
}

export interface ResolvedDbConnection {
	/** The URL without `sslmode`/`sslrootcert`; for `migrate` informational only, golang-migrate reads the raw URL. */
	url: string
	ssl: false | ConnectionOptions
	warnings: string[]
}

const TLS_PARAMS = ["sslmode", "sslrootcert"]

// pg lets any leftover URL parameter override the `ssl` object (`ssl=0` turns TLS off,
// `sslnegotiation=direct` swaps it for `true` and drops the CA), so everything else is refused.
const ALLOWED_PARAMS = {
	app: ["search_path", "application_name", "connect_timeout"],
	migrate: ["x-migrations-table", "x-migrations-table-quoted", "connect_timeout"],
} as const

// `postgres:` URLs leave a malformed IPv4 as a hostname, so the octets are checked here.
const LOOPBACK_V4 = /^127\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/

function isLoopback(host: string): boolean {
	if (host === "localhost" || host === "[::1]") return true
	const match = LOOPBACK_V4.exec(host)
	return match !== null && match.slice(1).every((octet) => Number(octet) <= 255)
}

function bare(host: string): string {
	return host
		.trim()
		.toLowerCase()
		.replace(/^\[(.*)\]$/, "$1")
}

/**
 * Applies libpq `sslmode`/`sslrootcert` meaning to a Postgres URL and returns an explicit `ssl`
 * object for the Node drivers, which each read those parameters differently.
 */
export function resolveDbConnection(raw: string, options: ResolveDbConnectionOptions): ResolvedDbConnection {
	const key = options.params === "app" ? "DATABASE_URL" : "MIGRATE_DATABASE_URL"
	const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"))

	let url: URL
	try {
		url = new URL(raw)
	} catch {
		// Node's TypeError carries the whole input, password included; throw a fresh one.
		throw new DbConfigError(`${key} is not a valid URL (one host only, as postgres://user:password@host:port/db)`)
	}
	if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
		throw new DbConfigError(`${key} must start with postgres:// or postgresql://`)
	}
	const host = url.hostname.toLowerCase()
	if (host === "") throw new DbConfigError(`${key} has no host`)
	if (host.includes(",")) throw new DbConfigError(`${key} names more than one host; only one is supported`)

	const allowed: readonly string[] = ALLOWED_PARAMS[options.params]
	for (const name of new Set(url.searchParams.keys())) {
		if (name === "host" || name === "hostaddr") {
			throw new DbConfigError(`${key} sets "${name}" as a parameter; put the host in the URL authority`)
		}
		if (!TLS_PARAMS.includes(name) && !allowed.includes(name)) {
			throw new DbConfigError(
				`${key} has unsupported parameter "${name}"; allowed: sslmode, sslrootcert, ${allowed.join(", ")}`,
			)
		}
		// URLSearchParams reads the first value, libpq and pg the last.
		if (url.searchParams.getAll(name).length > 1) throw new DbConfigError(`${key} sets "${name}" more than once`)
	}

	const sslmode = url.searchParams.get("sslmode")
	const sslrootcert = url.searchParams.get("sslrootcert")
	if (sslrootcert === "system") {
		throw new DbConfigError(`${key} sslrootcert=system is not supported; omit sslrootcert to use the system roots`)
	}
	if (sslrootcert === "") throw new DbConfigError(`${key} has an empty sslrootcert`)

	const readCa = (path: string): string => {
		try {
			return readFile(path)
		} catch {
			throw new DbConfigError(`${key} sslrootcert "${path}" cannot be read`)
		}
	}

	const warnings: string[] = []
	let ssl: false | ConnectionOptions
	switch (sslmode) {
		case "verify-full":
			ssl = sslrootcert === null ? { rejectUnauthorized: true } : { rejectUnauthorized: true, ca: readCa(sslrootcert) }
			break
		case "verify-ca":
			if (sslrootcert === null) {
				throw new DbConfigError(`${key} sslmode=verify-ca needs sslrootcert naming the server's own CA`)
			}
			if (!options.caServerSpecific) {
				throw new DbConfigError(
					`${key} sslmode=verify-ca needs DATABASE_CA_SERVER_SPECIFIC=true: any server holding a certificate from a shared CA would pass; use verify-full otherwise`,
				)
			}
			ssl = { rejectUnauthorized: true, ca: readCa(sslrootcert), checkServerIdentity: () => undefined }
			break
		case "disable":
		case null: {
			if (sslrootcert !== null) throw new DbConfigError(`${key} sets sslrootcert without TLS`)
			const listed = options.plaintextHosts.some((h) => bare(h) === bare(host))
			if (!isLoopback(host) && !listed) {
				throw new DbConfigError(
					`${key} connects to "${host}" without TLS; use sslmode=verify-full, or list the host in DATABASE_PLAINTEXT_HOSTS on a trusted private network`,
				)
			}
			if (sslmode === null) warnings.push(`${key} has no sslmode; connecting to "${host}" without TLS`)
			ssl = false
			break
		}
		default:
			throw new DbConfigError(
				`${key} sslmode=${sslmode} is not supported; use verify-full, verify-ca or disable (drivers disagree on the others)`,
			)
	}

	return { url: stripTlsParams(raw), ssl, warnings }
}

/** Drops the TLS pairs from the raw string; re-serializing via URL could re-encode the rest. */
function stripTlsParams(raw: string): string {
	const at = raw.indexOf("?")
	if (at === -1) return raw
	const [query = "", fragment] = raw.slice(at + 1).split("#", 2)
	const kept = query.split("&").filter((pair) => {
		const name = new URLSearchParams(pair).keys().next().value
		return pair !== "" && (name === undefined || !TLS_PARAMS.includes(name))
	})
	return (
		raw.slice(0, at) + (kept.length > 0 ? `?${kept.join("&")}` : "") + (fragment === undefined ? "" : `#${fragment}`)
	)
}
