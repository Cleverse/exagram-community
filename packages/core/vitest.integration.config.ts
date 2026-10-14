import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: false,
		environment: "node",
		include: ["**/*.integration.test.ts"],
		globalSetup: ["./test/global-setup.ts"],
		// One container; each worker gets its own clone of the migrated database (test/global-setup.ts),
		// so files run in parallel without racing each other's truncations. CI has two cores, shared with
		// Postgres.
		maxWorkers: 2,
		hookTimeout: 180_000,
		testTimeout: 60_000,
	},
})
