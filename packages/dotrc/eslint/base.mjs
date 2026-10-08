// @ts-check
import js from "@eslint/js"
import { defineConfig, globalIgnores } from "eslint/config"
import importPlugin from "eslint-plugin-import"
import unusedImportsPlugin from "eslint-plugin-unused-imports"
import tseslint from "typescript-eslint"

// A specifier that names ee code: an `ee` path segment (or `#ee` subpath import) or a `.ee` name part, before any
// `?query` or `#fragment`.
const EE_SPECIFIER = String.raw`(^|[/#])ee([/?#]|$)|\.ee($|[./?#])`
const EE_MESSAGE = "Only ee files and edition roots (edition.ts, edition.env.ts) import ee code."

export default defineConfig(
	globalIgnores(["**/dist/**", "**/gen/**", "**/.turbo/**", "*.config.{mjs,js,cjs,ts}"]),
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: process.cwd(),
			},
		},
		plugins: {
			import: importPlugin,
			"unused-imports": unusedImportsPlugin,
		},
		rules: {
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/consistent-type-imports": [
				"error",
				{ prefer: "type-imports", fixStyle: "inline-type-imports" },
			],
			"unused-imports/no-unused-imports": "error",
			"import/order": [
				"error",
				{
					alphabetize: { order: "asc", caseInsensitive: true },
					pathGroups: [{ pattern: "@exagram/**", group: "internal", position: "before" }],
					groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type", "object"],
					"newlines-between": "always",
				},
			],
			eqeqeq: "error",
		},
	},
	{
		files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
		ignores: [
			"**/ee/**",
			"**/*.ee/**",
			"**/*.ee.*",
			"**/*.ee.*/**",
			"**/edition.ts",
			"**/edition.tsx",
			"**/edition.env.ts",
		],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [{ regex: EE_SPECIFIER, message: EE_MESSAGE }],
				},
			],
			// no-restricted-imports does not see import().
			"no-restricted-syntax": [
				"error",
				{
					selector: `ImportExpression > Literal.source[value=/${EE_SPECIFIER.replaceAll("/", String.raw`\x2F`)}/]`,
					message: EE_MESSAGE,
				},
			],
		},
	},
)
