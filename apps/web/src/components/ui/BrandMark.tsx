const BRAND_CELLS = [
	"rgba(150,90,222,.16)",
	"rgba(150,90,222,.5)",
	"rgba(150,90,222,.16)",
	"rgba(150,90,222,.5)",
	"rgba(104,110,230,.95)",
	"rgba(150,90,222,.5)",
	"rgba(150,90,222,.16)",
	"rgba(150,90,222,.5)",
	"rgba(150,90,222,.16)",
]

/** The 3×3 logo mark: 5px cells in the sidebar and the mobile nav drawer, 4px in the mobile top bar. */
export const BrandMark = ({ cell = 5 }: { cell?: 4 | 5 }) => (
	<div
		aria-hidden
		className="grid flex-none"
		style={{ gridTemplateColumns: `repeat(3,${cell}px)`, gridTemplateRows: `repeat(3,${cell}px)`, gap: 1.5 }}
	>
		{BRAND_CELLS.map((background, index) => (
			<div key={index} style={{ background }} />
		))}
	</div>
)
