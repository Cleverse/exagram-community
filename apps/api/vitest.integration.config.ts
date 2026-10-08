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
		// `env.ts` parses `process.env` eagerly at import time, so every variable `parseEnv` requires
		// (no default) must be present before anything imports it — placeholders only, mirrored from
		// `.env.example`, never read from the real shell environment. `DATABASE_URL` is unused here:
		// each test builds its own repositories against the Testcontainers `pgUrl`.
		env: {
			CLIENT_IP_HEADER: "none",
			DATABASE_URL: "postgres://exagram:exagram@localhost:5432/exagram?sslmode=disable&search_path=exagram%2Cpublic",
			USERCONTENT_TOKEN_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			S3_ACCESS_KEY_ID: "exagram",
			S3_SECRET_ACCESS_KEY: "exagram-secret",
		},
	},
})
