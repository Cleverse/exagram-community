import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: false,
		environment: "node",
		// The Postgres lane runs from vitest.integration.config.ts and needs Docker; keep it out of
		// the default DB-free run.
		exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
		// `env.ts` parses `process.env` eagerly at import time, so unit tests need every variable
		// `parseEnv` requires (no default) present before anything imports it — placeholders only,
		// mirrored from `.env.example`, never read from the real shell environment.
		env: {
			DATABASE_URL: "postgres://exagram:exagram@localhost:5432/exagram?sslmode=disable&search_path=exagram%2Cpublic",
			USERCONTENT_TOKEN_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			S3_ACCESS_KEY_ID: "exagram",
			S3_SECRET_ACCESS_KEY: "exagram-secret",
			USERCONTENT_FRAME_ANCESTORS: "http://localhost:5173",
		},
	},
})
