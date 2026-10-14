import { randomUUID } from "node:crypto"
import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { resolveDbConnection } from "@exagram/core/repository/postgres/db-tls"

import { legacyLayoutReason, parsePreflightEnv } from "./preflight.env"

export interface PreflightDeps {
	log: (line: string) => void
	warn: (line: string) => void
	writeFile: (path: string, data: string) => void
	readFile: (path: string) => string
	link: (existing: string, created: string) => void
	unlink: (path: string) => void
	uid: number | undefined
}

const defaultDeps: PreflightDeps = {
	log: (line) => console.log(`preflight: ${line}`),
	warn: (line) => console.warn(`preflight: ${line}`),
	writeFile: (path, data) => writeFileSync(path, data, { flag: "wx" }),
	readFile: (path) => readFileSync(path, "utf8"),
	link: linkSync,
	unlink: unlinkSync,
	uid: process.getuid?.(),
}

function databaseTarget(key: string, raw: string): string {
	const url = new URL(raw)
	const hostname = url.hostname.toLowerCase()
	const path = url.pathname.replace(/^\//, "").split("/")[0] ?? ""
	let name: string
	try {
		name = decodeURIComponent(path)
	} catch {
		throw new Error(`${key} has a database name that is not valid percent-encoding`)
	}
	return JSON.stringify([hostname, url.port || "5432", name])
}

/**
 * The apps' boot checks, run once before `migrate` touches the database: both database URLs, the
 * storage settings, and a test write to STORAGE_DIR. Opens no database or network connection.
 * Throws on the first failure; logs one line per check that passed. `source` defaults to the process environment.
 */
export function runPreflight(source?: Record<string, unknown>, overrides: Partial<PreflightDeps> = {}): void {
	const deps = { ...defaultDeps, ...overrides }
	const legacy = legacyLayoutReason(source)
	if (legacy !== null) {
		throw new Error(
			`${legacy}: this deploy/.env was generated for the MinIO-based layout, which this version can't upgrade in place; see docs/self-host/troubleshooting.md "Installs from before the layer split". Nothing was changed.`,
		)
	}
	const env = parsePreflightEnv(source)
	deps.log("environment ok")

	for (const [key, params, raw] of [
		["DATABASE_URL", "app", env.DATABASE_URL],
		["MIGRATE_DATABASE_URL", "migrate", env.MIGRATE_DATABASE_URL],
	] as const) {
		const { ssl, warnings } = resolveDbConnection(raw, {
			plaintextHosts: env.DATABASE_PLAINTEXT_HOSTS,
			caServerSpecific: env.DATABASE_CA_SERVER_SPECIFIC,
			params,
		})
		for (const warning of warnings) deps.warn(warning)
		deps.log(`${key} ok (${ssl === false ? "without TLS" : "TLS, certificate verified"})`)
	}
	if (
		databaseTarget("DATABASE_URL", env.DATABASE_URL) !==
		databaseTarget("MIGRATE_DATABASE_URL", env.MIGRATE_DATABASE_URL)
	) {
		throw new Error(
			"DATABASE_URL and MIGRATE_DATABASE_URL must name the same database (host, port and database name); only the user, password and parameters may differ",
		)
	}

	const appParams = new URL(env.DATABASE_URL).searchParams
	const migrateParams = new URL(env.MIGRATE_DATABASE_URL).searchParams
	const [appMode, migrateMode] = [appParams.get("sslmode"), migrateParams.get("sslmode")]
	if (appMode !== migrateMode) {
		throw new Error(
			`DATABASE_URL and MIGRATE_DATABASE_URL must use the same sslmode (${appMode ?? "none"} vs ${migrateMode ?? "none"})`,
		)
	}
	if (appParams.get("sslrootcert") !== migrateParams.get("sslrootcert")) {
		throw new Error("DATABASE_URL and MIGRATE_DATABASE_URL must name the same sslrootcert")
	}

	if (env.STORAGE_DRIVER !== "filesystem") {
		deps.log(`storage ok (${env.STORAGE_DRIVER})`)
		return
	}
	const dir = env.STORAGE_DIR
	const probe = join(dir, `.preflight-${randomUUID()}`)
	const linkProbe = `${probe}.link`
	const content = `preflight ${probe}`
	let created = false
	let linked = false
	let failure: Error | undefined
	try {
		deps.writeFile(probe, content)
		created = true
		if (deps.readFile(probe) !== content) throw new Error("the probe file read back different bytes")
	} catch (error) {
		const reason = (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error))
		failure = new Error(`STORAGE_DIR ${dir} is not writable by uid ${deps.uid ?? "unknown"} (${reason})`)
	}
	if (created && failure === undefined) {
		try {
			deps.link(probe, linkProbe)
			linked = true
		} catch (error) {
			const reason = (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error))
			failure = new Error(`STORAGE_DIR ${dir} does not support hard links (${reason}), which uploads need`)
		}
	}
	for (const [path, exists] of [
		[linkProbe, linked],
		[probe, created],
	] as const) {
		if (!exists) continue
		try {
			deps.unlink(path)
		} catch (error) {
			if (failure === undefined) {
				const reason = (error as NodeJS.ErrnoException).code ?? String(error)
				failure = new Error(`STORAGE_DIR ${dir} is not writable by uid ${deps.uid ?? "unknown"} (${reason})`)
			}
		}
	}
	if (failure !== undefined) throw failure
	deps.log(`storage ok (filesystem, wrote, hard-linked and removed a probe file in ${dir})`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		runPreflight()
	} catch (error) {
		console.error(`preflight: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}
}
