import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startPgBoss } from "../../services/jobs.pgboss.service"

import { createPool } from "./db"
import { resolveDbConnection } from "./db-tls"

const PASSWORD = "tls-test-pw"
const SSL_QUERY = "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()"

let dir: string
let matching: StartedTestContainer
let mismatched: StartedTestContainer

function openssl(...args: string[]): void {
	execFileSync("openssl", args, { cwd: dir, stdio: "pipe" })
}

/** Signs `<name>.pem` with the test CA. `-extfile` rather than `-addext`, which LibreSSL lacks. */
function issueServerCert(name: string, subjectAltName: string): void {
	writeFileSync(
		path.join(dir, `${name}.ext`),
		`[v3]\nsubjectAltName=${subjectAltName}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`,
	)
	openssl(
		"req",
		"-new",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		`${name}.key`,
		"-out",
		`${name}.csr`,
		"-subj",
		`/CN=${name}`,
	)
	openssl(
		"x509",
		"-req",
		"-in",
		`${name}.csr`,
		"-CA",
		"ca.pem",
		"-CAkey",
		"ca.key",
		"-set_serial",
		String(Date.now()),
		"-days",
		"1",
		"-out",
		`${name}.pem`,
		"-extfile",
		`${name}.ext`,
		"-extensions",
		"v3",
	)
}

/** Postgres refuses a key it doesn't own with mode 0600, so the copy and chown happen inside the container. */
function startTlsPostgres(name: string): Promise<StartedTestContainer> {
	return (
		new GenericContainer("postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722")
			.withEnvironment({ POSTGRES_PASSWORD: PASSWORD })
			.withCopyContentToContainer([
				{ content: readFileSync(path.join(dir, `${name}.pem`)), target: "/tls-src/server.pem" },
				{ content: readFileSync(path.join(dir, `${name}.key`)), target: "/tls-src/server.key" },
			])
			.withCommand([
				"sh",
				"-c",
				"mkdir -p /etc/pgtls && cp /tls-src/server.pem /tls-src/server.key /etc/pgtls/ && chown -R postgres:postgres /etc/pgtls && chmod 600 /etc/pgtls/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/etc/pgtls/server.pem -c ssl_key_file=/etc/pgtls/server.key",
			])
			.withExposedPorts(5432)
			// The entrypoint logs it twice: once for the init-time server, once for the real one.
			.withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
			.start()
	)
}

function urlFor(container: StartedTestContainer, query: string): string {
	return `postgres://postgres:${PASSWORD}@${container.getHost()}:${container.getMappedPort(5432)}/postgres${query}`
}

const caQuery = (sslmode: string) => `?sslmode=${sslmode}&sslrootcert=${encodeURIComponent(path.join(dir, "ca.pem"))}`

function resolve(url: string) {
	return resolveDbConnection(url, { plaintextHosts: [], caServerSpecific: true, params: "app" })
}

async function sslViaPostgresJs(url: string): Promise<boolean> {
	const { url: stripped, ssl } = resolve(url)
	const sql = createPool({ url: stripped, ssl, max: 1 })
	try {
		const [row] = await sql.unsafe<{ ssl: boolean }[]>(SSL_QUERY)
		return row?.ssl ?? false
	} finally {
		await sql.end()
	}
}

async function sslViaPgBoss(url: string): Promise<boolean> {
	const { url: connectionString, ssl } = resolve(url)
	const boss = await startPgBoss({ connectionString, ssl })
	try {
		const { rows } = await boss.getDb().executeSql(SSL_QUERY)
		return (rows[0] as { ssl: boolean } | undefined)?.ssl ?? false
	} finally {
		await boss.stop({ graceful: false })
	}
}

beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), "exagram-db-tls-"))
	writeFileSync(
		path.join(dir, "ca.ext"),
		"[v3]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n",
	)
	openssl(
		"req",
		"-new",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		"ca.key",
		"-out",
		"ca.csr",
		"-subj",
		"/CN=exagram-test-ca",
	)
	openssl(
		"x509",
		"-req",
		"-in",
		"ca.csr",
		"-signkey",
		"ca.key",
		"-days",
		"1",
		"-out",
		"ca.pem",
		"-extfile",
		"ca.ext",
		"-extensions",
		"v3",
	)
	issueServerCert("matching", "DNS:localhost,IP:127.0.0.1")
	issueServerCert("mismatched", "DNS:not-the-host")
	;[matching, mismatched] = await Promise.all([startTlsPostgres("matching"), startTlsPostgres("mismatched")])
	// verify-full must fail below because of the SAN, not because Docker exposes some other address.
	expect(["localhost", "127.0.0.1"]).toContain(matching.getHost())
})

afterAll(async () => {
	await Promise.all([matching?.stop(), mismatched?.stop()])
	if (dir) rmSync(dir, { recursive: true, force: true })
})

describe.each([
	["postgres.js", sslViaPostgresJs],
	["pg (pg-boss)", sslViaPgBoss],
] as const)("%s", (_client, sslVia) => {
	it("verify-full with the CA connects over TLS", async () => {
		expect(await sslVia(urlFor(matching, caQuery("verify-full")))).toBe(true)
	})

	it("verify-full refuses a certificate whose SAN doesn't match the host", async () => {
		await expect(sslVia(urlFor(mismatched, caQuery("verify-full")))).rejects.toThrow(/altnames/)
	})

	it("verify-ca with a server-specific CA accepts the same certificate over TLS", async () => {
		expect(await sslVia(urlFor(mismatched, caQuery("verify-ca")))).toBe(true)
	})
})
