import { createContext, type HTMLAttributes, useContext } from "react"

import { type SheetKind, type SheetParams } from "./types"

export type SheetApi = {
	/** Opens a drawer, replacing whatever drawer was open. */
	open: <K extends SheetKind>(kind: K, params: SheetParams[K]) => void
	/** Steps into a sub-level (File actions → Share → Role); its header gets a Back button. */
	push: <K extends SheetKind>(kind: K, params: SheetParams[K]) => void
	/** Back one level, or closes from the first level. */
	back: () => void
	close: () => void
	/**
	 * Closes, then runs `then` once the drawer has given back its history entry. For a drawer that leaves its
	 * screen with a `replace` navigation, so the replace lands on the screen's entry, not the drawer's.
	 */
	closeThen: (then: () => void) => void
}

export const SheetApiContext = createContext<SheetApi | null>(null)

export const useSheet = (): SheetApi => {
	const api = useContext(SheetApiContext)
	if (!api) throw new Error("useSheet needs a SheetProvider")
	return api
}

export type SheetFrame = {
	/** 1 for the first level; a deeper level shows Back. */
	depth: number
	back: () => void
	close: () => void
	titleId: string
	/** Spread on the header so dragging it down dismisses the drawer. */
	dragHandleProps: HTMLAttributes<HTMLDivElement>
}

export const SheetFrameContext = createContext<SheetFrame | null>(null)
