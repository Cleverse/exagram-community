import clsx from "clsx"

import type { CSSProperties, ReactNode } from "react"

/**
 * The uppercase micro-label, Archivo 600 11px / .06em. The default is muted (`mono-label`): list and panel
 * section heads. `variant="sidebar"` is the same label in `label` grey (`mono-kicker`): the sidebar section
 * headers and panel heads such as History.
 */
export const SectionLabel = ({
	variant = "section",
	as: Tag = "div",
	className,
	style,
	children,
}: {
	variant?: "section" | "sidebar"
	as?: "div" | "h2" | "h3" | "span"
	className?: string
	style?: CSSProperties
	children: ReactNode
}) => (
	<Tag className={clsx(variant === "sidebar" ? "mono-kicker" : "mono-label", className)} style={style}>
		{children}
	</Tag>
)

/** Archivo 600 11px / .06em uppercase `label` grey — the sidebar section labels and panel heads. */
export const MonoKicker = ({
	className,
	style,
	children,
}: {
	className?: string
	style?: CSSProperties
	children: ReactNode
}) => (
	<SectionLabel variant="sidebar" className={className} style={style}>
		{children}
	</SectionLabel>
)

/** Column headers: sentence case, 12px muted, in Aura (`mono-col`) — the Project and Last activity headers. */
export const MonoCol = ({
	className,
	style,
	children,
}: {
	className?: string
	style?: CSSProperties
	children: ReactNode
}) => (
	<div className={clsx("mono-col whitespace-nowrap", className)} style={style}>
		{children}
	</div>
)

/** "Connected clients · 3": the Geist section label, then a 1px `line` rule filling the rest of the row. */
export const SectionRule = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
	<div className="flex items-center" style={{ gap: 14, ...style }}>
		<SectionLabel className="whitespace-nowrap">{children}</SectionLabel>
		<div className="flex-1" style={{ height: 1, background: "var(--color-line)" }} />
	</div>
)
