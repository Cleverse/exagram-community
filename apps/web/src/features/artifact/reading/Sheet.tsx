import { type ReactNode } from "react"

/** The sheet's padding: its width is the 720px measure plus the sides. */
const SHEET_PAD = { top: 36, side: 40, bottom: 52 }

/**
 * The document sheet on the canvas: the scroller is the `ground` canvas with 20px around a
 * white sheet, 6px radius and no border, padded `36px 40px 52px` and as wide as a 720px measure plus that
 * padding, centred. It holds the document's content and nothing else, so its first block starts flush at the
 * top. One `em`-based scale driven by the zoom keeps every margin inside proportional.
 */
export const Sheet = ({ zoom, children }: { zoom: number; children: ReactNode }) => (
	<div className="min-h-0 flex-1 overflow-auto bg-ground" style={{ padding: "20px 20px 48px" }}>
		<div
			className="mx-auto bg-panel"
			style={{
				maxWidth: 720 + SHEET_PAD.side * 2,
				padding: `${SHEET_PAD.top}px ${SHEET_PAD.side}px ${SHEET_PAD.bottom}px`,
				borderRadius: "var(--radius)",
				boxShadow: "var(--shadow-sheet)",
			}}
		>
			<article className="[&>:first-child]:mt-0" style={{ fontSize: `${(zoom / 100) * 15}px` }}>
				{children}
			</article>
		</div>
	</div>
)
