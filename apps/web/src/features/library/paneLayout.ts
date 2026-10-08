import type { CSSProperties } from "react"

import { paneMinWidth } from "@/features/library/hooks/useListWidth"

/** Full view covers the viewport at this layer; Present (300) covers it in turn. */
export const FULL_VIEW_LAYER = 200

/** Search (⌘K) opens over full view too, so it sits between full view and Present. */
export const SEARCH_LAYER = 250

/**
 * The preview pane's frame. Beside the list it takes everything to the right (`flex:1`) with no width cap,
 * so a wide screen never leaves an empty band at the edge; the document keeps its 720px measure inside the
 * sheet. It never shrinks under 360px, plus the side panel beside the document while one is open (Comments
 * or the Ledger, 320): the list (`flex: 0 1 <w>px`) gives up its space first. It sits edge
 * to edge with the list on a full 1px `pane-line` (v3). In full view it covers the viewport.
 */
export const paneFrame = (fullView: boolean, panel: string | null = null): CSSProperties =>
	fullView
		? { position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: FULL_VIEW_LAYER }
		: {
				position: "relative",
				flex: "1 1 0",
				minWidth: paneMinWidth(panel),
				borderLeft: "1px solid var(--color-pane-line)",
			}
