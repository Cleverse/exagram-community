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
		include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
		// `@/config/env.ts` parses `VITE_USERCONTENT_ORIGIN` at import time; compose supplies it for
		// dev/build, but nothing does for the test lane, and any test that reaches `@/config/apiClient`
		// needs it to exist. The value is never used to reach a real network endpoint in tests.
		env: { VITE_USERCONTENT_ORIGIN: "http://localhost:3002" },
	},
})
