import { describe, expect, it } from "vitest"

import { DbConfigError, resolveDbConnection, type ResolveDbConnectionOptions } from "./db-tls"

const CA = "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n"
const PASSWORD = "s3cr3t-pw"

const readFile = (path: string): string => {
	if (path === "/certs/db-ca.pem") return CA
	throw new Error(`ENOENT: ${path}`)
}

const app = (overrides: Partial<ResolveDbConnectionOptions> = {}): ResolveDbConnectionOptions => ({
	plaintextHosts: [],
	caServerSpecific: false,
	params: "app",
	readFile,
	...overrides,
})

const at = (host: string, query = "") => `postgres://exagram:${PASSWORD}@${host}:5432/exagram${query}`

function refusal(url: string, options = app()): DbConfigError {
	try {
		resolveDbConnection(url, options)
	} catch (error) {
		expect(error).toBeInstanceOf(DbConfigError)
		const message = (error as DbConfigError).message
		expect(message).not.toContain(PASSWORD)
		expect(message).not.toContain(url)
		return error as DbConfigError
	}
	throw new Error(`expected ${url} to be refused`)
}

describe("resolveDbConnection sslmode", () => {
	it("verify-full without sslrootcert verifies against the system roots", () => {
		const resolved = resolveDbConnection(at("db.example.com", "?sslmode=verify-full"), app())
		expect(resolved.ssl).toEqual({ rejectUnauthorized: true })
		expect(resolved.url).toBe(at("db.example.com"))
		expect(resolved.warnings).toEqual([])
	})

	it("verify-full with sslrootcert verifies against that CA and the host", () => {
		const resolved = resolveDbConnection(
			at("db.example.com", "?sslmode=verify-full&sslrootcert=%2Fcerts%2Fdb-ca.pem"),
			app(),
		)
		expect(resolved.ssl).toEqual({ rejectUnauthorized: true, ca: CA })
		expect(resolved.ssl).not.toHaveProperty("checkServerIdentity")
		expect(resolved.url).toBe(at("db.example.com"))
	})

	it("verify-ca with a server-specific CA skips only the hostname check", () => {
		const resolved = resolveDbConnection(
			at("10.0.0.5", "?sslmode=verify-ca&sslrootcert=/certs/db-ca.pem"),
			app({ caServerSpecific: true }),
		)
		expect(resolved.ssl).toMatchObject({ rejectUnauthorized: true, ca: CA })
		const ssl = resolved.ssl as { checkServerIdentity: (host: string, cert: object) => Error | undefined }
		expect(ssl.checkServerIdentity("anything", {})).toBeUndefined()
		expect(resolved.url).toBe(at("10.0.0.5"))
	})

	it("verify-ca without DATABASE_CA_SERVER_SPECIFIC is refused", () => {
		expect(refusal(at("10.0.0.5", "?sslmode=verify-ca&sslrootcert=/certs/db-ca.pem")).message).toContain(
			"DATABASE_CA_SERVER_SPECIFIC",
		)
	})

	it("verify-ca without sslrootcert is refused, server-specific or not", () => {
		for (const caServerSpecific of [true, false]) {
			expect(refusal(at("10.0.0.5", "?sslmode=verify-ca"), app({ caServerSpecific })).message).toContain("sslrootcert")
		}
	})

	it.each(["require", "prefer", "allow", "VERIFY-FULL", "bogus"])("sslmode=%s is refused", (mode) => {
		expect(refusal(at("db.example.com", `?sslmode=${mode}`)).message).toContain(`sslmode=${mode}`)
		expect(refusal(at("db.example.com", `?sslmode=${mode}&sslrootcert=/certs/db-ca.pem`)).message).toContain(
			`sslmode=${mode}`,
		)
	})

	it("sslrootcert=system is refused", () => {
		expect(refusal(at("db.example.com", "?sslmode=verify-full&sslrootcert=system")).message).toContain(
			"sslrootcert=system",
		)
	})

	it("sslrootcert with disable or no sslmode is refused", () => {
		expect(refusal(at("localhost", "?sslmode=disable&sslrootcert=/certs/db-ca.pem")).message).toContain("sslrootcert")
		expect(refusal(at("localhost", "?sslrootcert=/certs/db-ca.pem")).message).toContain("sslrootcert")
	})

	it("an unreadable CA file is refused naming the path", () => {
		const error = refusal(at("db.example.com", "?sslmode=verify-full&sslrootcert=/certs/missing.pem"))
		expect(error.message).toContain("/certs/missing.pem")
	})

	it("reads the CA from disk by default", () => {
		expect(() =>
			resolveDbConnection(at("db.example.com", "?sslmode=verify-full&sslrootcert=/nonexistent/ca.pem"), {
				plaintextHosts: [],
				caServerSpecific: false,
				params: "app",
			}),
		).toThrow(/\/nonexistent\/ca\.pem/)
	})
})

describe("resolveDbConnection plaintext", () => {
	it.each(["localhost", "LOCALHOST", "127.0.0.1", "127.1.2.3", "127.255.255.254", "[::1]"])(
		"%s boots without TLS",
		(host) => {
			const disabled = resolveDbConnection(at(host, "?sslmode=disable"), app())
			expect(disabled.ssl).toBe(false)
			expect(disabled.warnings).toEqual([])
			expect(disabled.url).toBe(at(host))

			const absent = resolveDbConnection(at(host), app())
			expect(absent.ssl).toBe(false)
			expect(absent.warnings).toHaveLength(1)
			expect(absent.warnings[0]).toContain("no sslmode")
		},
	)

	it.each(["postgres", "db.internal", "10.0.0.5", "127.999.999.999", "127.1", "127.0.0.01", "127.0.0.1.example.com"])(
		"%s without TLS is refused unless listed",
		(host) => {
			for (const query of ["?sslmode=disable", ""]) {
				const message = refusal(at(host, query)).message
				expect(message).toContain(host)
				expect(message).toContain("DATABASE_PLAINTEXT_HOSTS")
				expect(resolveDbConnection(at(host, query), app({ plaintextHosts: [host.toUpperCase()] })).ssl).toBe(false)
			}
		},
	)

	it("a listed host covers only itself", () => {
		expect(refusal(at("other", "?sslmode=disable"), app({ plaintextHosts: ["postgres"] })).message).toContain("other")
		expect(refusal(at("postgres.evil", "?sslmode=disable"), app({ plaintextHosts: ["postgres"] })).message).toContain(
			"postgres.evil",
		)
	})

	it("matches a listed IPv6 host with or without brackets", () => {
		for (const listed of ["fd00::5", "[fd00::5]"]) {
			expect(resolveDbConnection(at("[fd00::5]", "?sslmode=disable"), app({ plaintextHosts: [listed] })).ssl).toBe(
				false,
			)
		}
	})
})

describe("resolveDbConnection parameters", () => {
	it.each(["ssl=0", "sslnegotiation=direct", "sslcert=/c.pem", "sslkey=/k.pem", "options=-c%20x", "PGSSLMODE=disable"])(
		"refuses %s naming it",
		(pair) => {
			const name = pair.split("=")[0]!
			expect(refusal(at("db.example.com", `?sslmode=verify-full&${pair}`)).message).toContain(`"${name}"`)
		},
	)

	it.each(["host=other", "hostaddr=10.0.0.9"])("refuses %s", (pair) => {
		const name = pair.split("=")[0]!
		expect(refusal(at("db.example.com", `?sslmode=verify-full&${pair}`)).message).toContain(`"${name}"`)
	})

	it("refuses a parameter given twice", () => {
		expect(refusal(at("db.example.com", "?sslmode=verify-full&sslmode=disable")).message).toContain('"sslmode"')
	})

	it("refuses migrate parameters in the app URL and app parameters in the migrate URL", () => {
		expect(refusal(at("localhost", "?x-migrations-table=t")).message).toContain('"x-migrations-table"')
		expect(refusal(at("localhost", "?search_path=exagram"), app({ params: "migrate" })).message).toContain(
			'"search_path"',
		)
	})

	it.each([`postgres://u:${PASSWORD}@h1,h2:5432/db`, `postgres://u:${PASSWORD}@h1:5432,h2:5433/db`])(
		"refuses multiple hosts: %s",
		(url) => {
			refusal(url)
		},
	)

	it("refuses other schemes and a missing host", () => {
		refusal(`mysql://u:${PASSWORD}@localhost/db`)
		refusal(`postgres://u:${PASSWORD}@/db`)
		refusal(`not a url ${PASSWORD}`)
	})

	it("keeps the allowed parameters byte for byte", () => {
		const resolved = resolveDbConnection(
			at(
				"db.example.com",
				"?application_name=exa%20gram&sslmode=verify-full&search_path=exagram%2Cpublic&connect_timeout=5&sslrootcert=/certs/db-ca.pem",
			),
			app(),
		)
		expect(resolved.url).toBe(
			at("db.example.com", "?application_name=exa%20gram&search_path=exagram%2Cpublic&connect_timeout=5"),
		)
	})
})

describe("resolveDbConnection existing URLs", () => {
	it("bundled app URL boots with the bundled layer's opt-in", () => {
		const url = "postgres://exagram:pw@postgres:5432/exagram?sslmode=disable&search_path=exagram%2Cpublic"
		const resolved = resolveDbConnection(url, app({ plaintextHosts: ["postgres"] }))
		expect(resolved).toEqual({
			url: "postgres://exagram:pw@postgres:5432/exagram?search_path=exagram%2Cpublic",
			ssl: false,
			warnings: [],
		})
	})

	it("bundled migrate URL passes with migrate params", () => {
		const url =
			"postgres://exagram:pw@postgres:5432/exagram?sslmode=disable&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"
		const resolved = resolveDbConnection(url, app({ plaintextHosts: ["postgres"], params: "migrate" }))
		expect(resolved.ssl).toBe(false)
		expect(resolved.warnings).toEqual([])
	})

	it("dev URL boots with a warning", () => {
		const resolved = resolveDbConnection("postgres://exagram:exagram@localhost:25432/exagram", app())
		expect(resolved.ssl).toBe(false)
		expect(resolved.warnings).toHaveLength(1)
		expect(resolved.url).toBe("postgres://exagram:exagram@localhost:25432/exagram")
	})

	it("a URL through a loopback database proxy boots unchanged", () => {
		const url = "postgres://u:p@127.0.0.1:5432/exagram?search_path=exagram%2Cpublic"
		const resolved = resolveDbConnection(url, app())
		expect(resolved.ssl).toBe(false)
		expect(resolved.url).toBe(url)
		expect(resolved.warnings).toHaveLength(1)
	})
})
