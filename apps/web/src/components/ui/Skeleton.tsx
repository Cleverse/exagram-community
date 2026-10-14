import { type CSSProperties, type ReactNode } from "react"

/** One grey placeholder bar. Decoration only: the surrounding `SkeletonStatus` names the wait. */
export const Skeleton = ({
	width = "100%",
	height = 12,
	radius = 4,
	style,
}: {
	width?: CSSProperties["width"]
	height?: CSSProperties["height"]
	radius?: CSSProperties["borderRadius"]
	style?: CSSProperties
}) => (
	<span
		aria-hidden
		className="block flex-none bg-row-selected"
		style={{
			width,
			height,
			borderRadius: radius,
			animation: "skeletonPulse 1.4s var(--ease-loop) infinite",
			...style,
		}}
	/>
)

/** Announces a load once for screen readers, and holds the placeholders drawn in its place. */
export const SkeletonStatus = ({
	label = "Loading…",
	className,
	style,
	children,
}: {
	label?: string
	className?: string
	style?: CSSProperties
	children: ReactNode
}) => (
	<div role="status" aria-busy className={className} style={style}>
		<span className="sr-only">{label}</span>
		{children}
	</div>
)

// Fixed widths, so the placeholder rows read as a list rather than a bar chart, and never reshuffle on render.
const NAME_WIDTHS = ["46%", "62%", "38%", "54%", "70%", "42%", "58%", "34%"]

/** Rows shaped like the library's list rows (44px, icon, name, trailing meta) while a list loads. */
export const SkeletonRows = ({
	count = 6,
	showMeta = true,
	label,
}: {
	count?: number
	/** The trailing cells; hidden where the real rows hide them. */
	showMeta?: boolean
	label?: string
}) => (
	<SkeletonStatus label={label} style={{ paddingTop: 12 }}>
		{Array.from({ length: count }, (_, index) => (
			<div
				key={index}
				className="flex items-center"
				style={{ gap: 12, height: 44, padding: "0 10px", margin: "1px 0" }}
			>
				<Skeleton width={20} height={20} radius={5} />
				<div className="min-w-0 flex-1">
					<Skeleton width={NAME_WIDTHS[index % NAME_WIDTHS.length]} height={12} />
				</div>
				{showMeta ? <Skeleton width={72} height={10} /> : null}
			</div>
		))}
	</SkeletonStatus>
)

const LINE_WIDTHS = ["92%", "100%", "86%", "96%", "64%"]

/** Paragraph-shaped lines for a body of text still on its way. */
export const SkeletonText = ({
	lines = 5,
	label,
	style,
}: {
	lines?: number
	label?: string
	style?: CSSProperties
}) => (
	<SkeletonStatus label={label} className="flex flex-col" style={{ gap: 10, ...style }}>
		{Array.from({ length: lines }, (_, index) => (
			<Skeleton key={index} width={LINE_WIDTHS[index % LINE_WIDTHS.length]} height={12} />
		))}
	</SkeletonStatus>
)
