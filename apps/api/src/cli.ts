import { pathToFileURL } from "node:url"

import type { IssuedResetLink } from "@exagram/core/entity/password-reset"

export const CLI_USAGE = "usage: node dist/cli.js reset-link <email>"

export interface CliDeps {
	createResetLink: (email: string) => Promise<IssuedResetLink>
	log: (line: string) => void
	error: (line: string) => void
}

/**
 * The api image's operator commands, run as `docker compose exec api node dist/cli.js <command>`.
 * `reset-link <email>` prints a Reset Link for any account, whatever ADMIN_PASSWORD_RESET says, for an
 * operator locked out as the only Admin. Returns the exit code.
 */
export async function runCli(args: readonly string[], deps: CliDeps): Promise<number> {
	const [command, email, ...rest] = args
	if (command !== "reset-link" || email === undefined || email.trim() === "" || rest.length > 0) {
		deps.error(CLI_USAGE)
		return 2
	}
	try {
		const issued = await deps.createResetLink(email)
		deps.log(issued.url)
		deps.log(
			`Reset link for ${email.trim().toLowerCase()}, shown only now. It works once, until ${issued.expiresAt.toISOString()}; send it yourself.`,
		)
		return 0
	} catch (error) {
		deps.error(`reset-link: ${error instanceof Error ? error.message : String(error)}`)
		return 1
	}
}

/** The real Reset Link maker: imported only once a valid command needs it, since env.ts parses on import. */
async function connect() {
	const { ENV } = await import("./env")
	const { createPool, TransactionProvider } = await import("@exagram/core/repository/postgres/db")
	const { resolveDbEnv } = await import("@exagram/core/repository/postgres/db.env")
	const { AuthRepository } = await import("@exagram/core/repository/postgres/auth.repository")
	const { LedgerRepository } = await import("@exagram/core/repository/postgres/ledger.repository")
	const { PasswordResetsRepository } = await import("@exagram/core/repository/postgres/password-resets.repository")
	const { LedgerService } = await import("@exagram/core/services/ledger/ledger.service")
	const { ResetLinksUsecase } = await import("./usecase/workspace/reset-links.usecase")
	const { adminPasswordReset } = await import("./edition.env")

	const db = resolveDbEnv(ENV, (warning) => console.error(warning))
	const sql = createPool({ url: db.url, ssl: db.ssl, max: 1 })
	const resetLinks = new ResetLinksUsecase(
		new AuthRepository(sql),
		new PasswordResetsRepository(sql),
		new LedgerService(new LedgerRepository(sql)),
		new TransactionProvider(sql),
		ENV.WEB_ORIGIN,
		adminPasswordReset(ENV),
	)
	return { resetLinks, close: () => sql.end() }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	let close = (): Promise<void> => Promise.resolve()
	const code = await runCli(process.argv.slice(2), {
		createResetLink: async (email) => {
			const connected = await connect()
			close = connected.close
			return connected.resetLinks.createByOperator(email)
		},
		log: (line) => console.log(line),
		error: (line) => console.error(line),
	})
	await close()
	process.exit(code)
}
