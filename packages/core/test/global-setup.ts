import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import postgres from "postgres"

import type { TestProject } from "vitest/node"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(HERE, "../../../database/postgres/migrations")

let container: StartedPostgreSqlContainer

/**
 * Orbstack users: point DOCKER_HOST at the Orbstack socket first —
 * `export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock`.
 */
export default async function setup({ provide }: TestProject) {
	// Pinned by digest: Turbo caches integration results, and a cached pass must not outlive a republished tag.
	container = await new PostgreSqlContainer(
		"postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722",
	).start()
	const url = container.getConnectionUri()

	// max:1 — schema setup is strictly sequential and each file self-manages BEGIN/COMMIT.
	const sql = postgres(url, { max: 1, onnotice: () => {} })
	try {
		const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".up.sql")).sort()
		for (const file of files) {
			const content = await readFile(path.join(MIGRATIONS_DIR, file), "utf8")
			// .simple() uses the simple protocol, which is what multi-statement files need.
			await sql.unsafe(content).simple()
		}
	} finally {
		await sql.end()
	}

	provide("pgUrl", url)

	return async () => {
		await container.stop()
	}
}
