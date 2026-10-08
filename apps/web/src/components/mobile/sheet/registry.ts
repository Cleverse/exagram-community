import { type ComponentType } from "react"

import { SHEET_KINDS, type SheetKind } from "./types"

export type SheetLoader = () => Promise<{ default: ComponentType<{ params: never }> }>

/**
 * Every drawer, found by file name: `src/features/<area>/sheets/<kind>.sheet.mobile.tsx` with a default export.
 * Nothing lists them by hand, so drawers built in parallel never edit a shared file.
 */
const SHEET_MODULES = import.meta.glob<{ default: ComponentType<{ params: never }> }>(
	"/src/features/**/*.sheet.mobile.tsx",
)

const kindOf = (path: string) => /\/([^/]+)\.sheet\.mobile\.tsx$/.exec(path)?.[1] ?? null

const isSheetKind = (value: string): value is SheetKind => (SHEET_KINDS as readonly string[]).includes(value)

/** Kind → loader. A file named for no kind, or two files for one kind, is a mistake worth failing on. */
export const indexSheets = (modules: Record<string, SheetLoader>): Map<SheetKind, SheetLoader> => {
	const index = new Map<SheetKind, SheetLoader>()
	for (const [path, load] of Object.entries(modules)) {
		const kind = kindOf(path)
		if (kind === null || !isSheetKind(kind)) throw new Error(`${path} names no drawer kind (see SheetParams)`)
		if (index.has(kind)) throw new Error(`Two drawers for "${kind}": ${path}`)
		index.set(kind, load)
	}
	return index
}

export const SHEETS = indexSheets(SHEET_MODULES)
