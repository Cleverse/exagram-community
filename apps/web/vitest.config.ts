import path from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
	plugins: [react()],
	test: {
		globals: false,
		environment: "happy-dom",
		setupFiles: ["./src/test/setup.ts"],
		// One window and module cache per worker instead of per file: most of a file's cost was a fresh worker,
		// happy-dom window and React import. `src/test/setup.ts` puts the window and modules back after each file.
		isolate: false,
		// Without isolation a worker's heap grows with every file it runs; CI's default ~2 GB limit runs out once a
		// worker takes a few hundred files.
		execArgv: ["--max-old-space-size=4096"],
		include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
		// `@/config/env.ts` parses `VITE_USERCONTENT_ORIGIN` at import time; compose supplies it for
		// dev/build, but nothing does for the test lane, and any test that reaches `@/config/apiClient`
		// needs it to exist. The value is never used to reach a real network endpoint in tests.
		env: { VITE_USERCONTENT_ORIGIN: "http://localhost:3002" },
	},
})
