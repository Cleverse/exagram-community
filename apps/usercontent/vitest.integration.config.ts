import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: false,
		environment: "node",
		include: ["**/*.integration.test.ts"],
		globalSetup: ["./test/global-setup.ts"],
		// One shared container for the whole run; files run serially so they cannot race on the same
		// tables between truncations.
		fileParallelism: false,
		hookTimeout: 180_000,
		testTimeout: 60_000,
	},
})
