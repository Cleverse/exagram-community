import clsx from "clsx"
import { Link } from "react-router"

import type { CSSProperties, ReactNode } from "react"

/**
 * `UnderlineTabs`' look for navigation: the sidebar's section switcher and the Settings sections, where each
 * item is an address rather than a panel on the same page. A `<nav>` of real links, so they open in a new tab
 * and read as navigation; the current one carries `aria-current="page"`.
 *
 * `variant="underline"` (default): the current item has an ink `inset 0 -2px 0` underline at 600, the rest are
 * 500 muted, over a 1px base line. `variant="scope"` is the library's scope row (v5 §3): 28px text tabs 16px apart
 * with no padding or base line, the current one ink at 600 over the same underline, the rest `secondary` at 500
 * turning ink on hover, and every count Geist Mono 12px `muted-2`. An item may carry a Geist Mono `count`.
 */
export const UnderlineNav = ({
	items,
	ariaLabel,
	size = "md",
	variant = "underline",
	className,
	style,
}: {
	items: { to: string; label: string; active: boolean; count?: ReactNode }[]
	ariaLabel: string
	size?: "md" | "sm"
	variant?: "underline" | "scope"
	className?: string
	style?: CSSProperties
}) =>
	variant === "scope" ? (
		<nav aria-label={ariaLabel} className={clsx("flex", className)} style={{ gap: 16, ...style }}>
			{items.map((item) => (
				<Link
					key={item.to}
					to={item.to}
					aria-current={item.active ? "page" : undefined}
					className={clsx(
						"flex flex-none items-center whitespace-nowrap",
						item.active ? "text-ink" : "text-secondary hover:text-ink",
					)}
					style={{
						gap: 6,
						height: 28,
						padding: 0,
						borderRadius: 0,
						fontSize: 14,
						fontWeight: item.active ? 600 : 500,
						// The idle tab keeps a transparent underline, so selecting one never shifts the row.
						boxShadow: item.active ? "inset 0 -2px 0 var(--color-ink)" : "inset 0 -2px 0 transparent",
						transition:
							"box-shadow var(--duration-tab) var(--ease-arrive), color var(--duration-press) var(--ease-arrive)",
					}}
				>
					{item.label}
					{item.count === undefined ? null : (
						<span className="font-mono text-muted-2" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
							{item.count}
						</span>
					)}
				</Link>
			))}
		</nav>
	) : (
		<nav aria-label={ariaLabel} className={clsx("relative flex", className)} style={{ gap: 18, ...style }}>
			<div
				aria-hidden
				className="absolute inset-x-0 bottom-0"
				style={{ height: 1, background: "var(--color-pane-line)" }}
			/>
			{items.map((item) => (
				<Link
					key={item.to}
					to={item.to}
					aria-current={item.active ? "page" : undefined}
					className={clsx(
						"relative flex items-center whitespace-nowrap",
						item.active ? "text-ink" : "text-muted hover:text-ink",
					)}
					style={{
						gap: 6,
						height: size === "md" ? 32 : 30,
						fontSize: size === "md" ? 14 : 13,
						fontWeight: item.active ? 600 : 500,
						boxShadow: item.active ? "inset 0 -2px 0 var(--color-ink)" : "inset 0 -2px 0 transparent",
						transition:
							"color var(--duration-tab) var(--ease-arrive), box-shadow var(--duration-tab) var(--ease-arrive)",
					}}
				>
					{item.label}
					{item.count === undefined ? null : (
						<span className="font-mono text-muted" style={{ fontSize: 11 }}>
							{item.count}
						</span>
					)}
				</Link>
			))}
		</nav>
	)
