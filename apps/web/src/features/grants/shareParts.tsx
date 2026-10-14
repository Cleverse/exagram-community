import { type ReactNode } from "react"

export const MONO = "var(--font-mono)"

/** v3.8's section heading: 14px gray, sentence case. */
export const HEADING = { fontSize: 14, color: "var(--color-muted)" } as const

export const Round = ({
	size,
	background = "var(--color-subtle)",
	color = "var(--color-secondary)",
	dashed = false,
	children,
}: {
	size: number
	background?: string
	color?: string
	dashed?: boolean
	children: ReactNode
}) => (
	<div
		className="grid flex-none place-items-center"
		style={{
			width: size,
			height: size,
			borderRadius: "50%",
			background: dashed ? "var(--color-panel)" : background,
			border: dashed ? "1px dashed var(--color-path-slash)" : undefined,
			color,
			fontFamily: MONO,
			fontWeight: 500,
			fontSize: size >= 34 ? 12 : 9,
		}}
	>
		{children}
	</div>
)

/** A section heading in the v3.8 language: 14px gray, sentence case. */
export const Heading = ({ children, note }: { children: ReactNode; note?: string }) => (
	<div style={{ marginTop: 18, marginBottom: 2 }}>
		<div className="text-muted" style={{ fontSize: 14 }}>
			{children}
		</div>
		{note ? (
			<div className="text-muted-2" style={{ fontSize: 12.5, marginTop: 2 }}>
				{note}
			</div>
		) : null}
	</div>
)
