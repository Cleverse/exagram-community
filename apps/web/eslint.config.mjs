// @ts-check
import { defineConfig, globalIgnores } from "eslint/config"

import react from "@exagram/dotrc/eslint/react.mjs"

export default defineConfig(
	...react,
	// Plain Node scripts and Playwright's generated reports, not application code under the
	// project's TypeScript program; their untyped shape does not belong to the type-aware rule set.
	globalIgnores(["e2e/fixtures/make-fixtures.mjs", "playwright-report/", "test-results/"]),
)
