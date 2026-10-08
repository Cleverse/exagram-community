import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: false,
		environment: "node",
		// The Postgres lane runs from vitest.integration.config.ts and needs Docker; keep it out of
		// the default DB-free run.
		exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
	},
})
