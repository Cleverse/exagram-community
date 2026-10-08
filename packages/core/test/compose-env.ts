import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// compose.yml plus every layer gen-secrets.sh can add to COMPOSE_FILE; a layer can add or override
// a service's env keys (compose.postgres.yml sets DATABASE_PLAINTEXT_HOSTS).
const COMPOSE_FILES = ["compose.yml", "compose.postgres.yml", "compose.db-ca.yml"].map((name) =>
	fileURLToPath(new URL(`../../../deploy/${name}`, import.meta.url)),
)

/**
 * Returns the environment keys listed under `services.<service>.environment:` in one compose
 * file, or null when the file doesn't define the service. Line-scans the block by indentation;
 * deliberately avoids a yaml dependency for files this narrow.
 */
function serviceEnvKeys(path: string, service: string): string[] | null {
	const lines = readFileSync(path, "utf-8").split("\n")

	const serviceIndex = lines.findIndex((line) => line.match(new RegExp(`^  ${service}:\\s*$`)))
	if (serviceIndex === -1) return null

	const keys: string[] = []
	let inEnvironment = false
	for (let i = serviceIndex + 1; i < lines.length; i++) {
		const line = lines[i]!
		// The next service, or the next top-level key, ends this service's block.
		if (line.match(/^ {2}\S/) || line.match(/^\S/)) break
		if (line.match(/^ {4}\S/)) {
			inEnvironment = line.match(/^ {4}environment:\s*$/) !== null
			continue
		}
		const match = inEnvironment ? line.match(/^ {6}([A-Z0-9_]+):/) : null
		if (match) keys.push(match[1]!)
	}
	return keys
}

/** Every environment key any compose layer passes `<service>`, across `deploy/compose*.yml`. */
export function composeServiceEnvKeys(service: string): string[] {
	const perFile = COMPOSE_FILES.map((path) => serviceEnvKeys(path, service))
	if (perFile.every((keys) => keys === null)) {
		throw new Error(`service not found in deploy/compose*.yml: ${service}`)
	}
	return [...new Set(perFile.flatMap((keys) => keys ?? []))]
}
