const GAP = 6
const EDGE = 8
/** Below this much room on the preferred side, the card flips to the other side if that has more. */
const FLIP_BELOW = 200

/**
 * Where the card goes for a trigger at `anchor` in a `viewport`-sized window: 6px off the trigger on the
 * preferred side, flipped when that side is short on room, held 8px inside the window on every edge, and
 * capped at 60% of the window height or the room it has, whichever is smaller.
 */
export const menuPosition = (
	anchor: Pick<DOMRect, "top" | "bottom" | "left">,
	placement: "down" | "up",
	width: number,
	viewport: { width: number; height: number },
) => {
	const below = viewport.height - anchor.bottom - GAP - EDGE
	const above = anchor.top - GAP - EDGE
	const preferred = placement === "up" ? above : below
	const other = placement === "up" ? below : above
	const side = preferred < FLIP_BELOW && other > preferred ? (placement === "up" ? "down" : "up") : placement
	const room = side === "up" ? above : below
	const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - width - EDGE))
	const vertical = side === "up" ? { bottom: viewport.height - anchor.top + GAP } : { top: anchor.bottom + GAP }
	return { left, ...vertical, maxHeight: Math.max(0, Math.min(viewport.height * 0.6, room)) }
}
