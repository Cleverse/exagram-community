const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8]

/**
 * Aura Matrix's thinking matrix in its Pulse register: a 3×3 grid of accent squares whose opacity runs a diagonal
 * wave on the loop curve. One per indexing row. The design keeps one matrix per screen; this departs from it on
 * purpose, since the mark is temporary and wordless. It is named for screen readers.
 */
export const ThinkingMatrix = ({ size = 15, label = "Indexing" }: { size?: number; label?: string }) => {
	const gap = Math.max(1, Math.round(size / 10))
	const cell = (size - gap * 2) / 3
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className="thinking-matrix inline-grid flex-none"
			style={{ width: size, height: size, gridTemplateColumns: `repeat(3, ${cell}px)`, gap }}
		>
			{CELLS.map((index) => (
				<span
					key={index}
					aria-hidden
					style={{
						width: cell,
						height: cell,
						background: "var(--color-accent)",
						animation: "thinkingPulse 1400ms var(--ease-loop) infinite",
						// Row plus column: the wave crosses the grid from top-left to bottom-right.
						animationDelay: `${((index % 3) + Math.floor(index / 3)) * 140}ms`,
					}}
				/>
			))}
		</span>
	)
}
