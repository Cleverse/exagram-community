/**
 * The gapped vertical divider (T:L1736): a 1px `pane-line` that stops `inset` px short of the top and
 * bottom, so a vertical rule never touches the horizontal ones it meets. v3 keeps it only inside a screen —
 * the Settings column and the Context band; the shell's panes sit edge to edge on full
 * 1px borders instead. Absolutely positioned against its
 * parent's `side` edge — **the parent must be `position: relative`**. `tone="light"` is the white-at-.12
 * line on the dark Context band.
 */
export const GapLine = ({
	side,
	inset = 12,
	tone = "default",
}: {
	side: "left" | "right"
	inset?: number
	tone?: "default" | "light"
}) => (
	<div
		aria-hidden
		style={{
			position: "absolute",
			top: inset,
			bottom: inset,
			[side]: 0,
			width: 1,
			background: tone === "light" ? "var(--color-line-on-dark)" : "var(--color-pane-line)",
		}}
	/>
)
