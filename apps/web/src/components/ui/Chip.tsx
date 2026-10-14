import clsx from "clsx"

import type { CSSProperties, ReactNode } from "react"

type ChipVariant = "settings" | "filter" | "source"

/**
 * One preset per place the prototype draws a chip.
 * Only the geometry the prototype writes at every call site of a variant is here: `white-space`
 * and `min-width` vary between the chips of one variant, so both come from the call site.
 */
const CHIP: Record<ChipVariant, CSSProperties> = {
	// Project header settings chips (lines 100–110): the caller supplies background/colour.
	settings: { height: 34, padding: "0 12px", fontSize: 14, gap: 8 },
	// Audit client chips (line 667): bordered, 500 weight.
	filter: { height: 36, padding: "0 14px", fontSize: 14, fontWeight: 500, gap: 8 },
	// Context "Sources" chips (line 450, dark panel): 30px, full radius.
	source: { height: 30, padding: "0 10px", fontSize: 13, gap: 8 },
}

export type ChipProps = {
	variant?: ChipVariant
	background?: string
	color?: string
	borderColor?: string
	onClick?: () => void
	/**
	 * The element to render. Defaults to `button` when there is an `onClick` and `div` otherwise;
	 * pass it outright where the prototype draws a `<button>` that this build has nothing to do.
	 */
	as?: "button" | "div"
	title?: string
	className?: string
	style?: CSSProperties
	children: ReactNode
}

export const Chip = ({
	variant = "settings",
	background,
	color,
	borderColor,
	onClick,
	as,
	title,
	className,
	style,
	children,
}: ChipProps) => {
	const css: CSSProperties = {
		...CHIP[variant],
		borderRadius: "var(--radius)",
		background,
		color,
		border: borderColor ? `1px solid ${borderColor}` : undefined,
		...style,
	}
	const classes = clsx("flex items-center", className)
	return (as ?? (onClick ? "button" : "div")) === "button" ? (
		<button type="button" title={title} onClick={onClick} className={classes} style={css}>
			{children}
		</button>
	) : (
		<div title={title} className={classes} style={css}>
			{children}
		</div>
	)
}

/**
 * The segmented toggle: Mine / Team on Activity, Project / Day on the recap. A white well with a
 * hairline and a faint inset shadow; the selected segment is near-black with white text, its count
 * at .7, at v5's 14px with a 12px count. `tone="light"` is the recap's quieter toggle: a `surface-soft`
 * track and the selected segment plain white, both 500, at 13px with an 11px count. Switching does not animate. `aria-pressed` carries the state.
 */
export const SegmentedControl = <T extends string>({
	options,
	value,
	onChange,
	ariaLabel,
	tone = "solid",
}: {
	options: { value: T; label: string; count?: ReactNode }[]
	value: T
	onChange: (next: T) => void
	ariaLabel?: string
	tone?: "solid" | "light"
}) => (
	<div
		role="group"
		aria-label={ariaLabel}
		className={clsx("flex flex-none", tone === "light" ? "bg-surface-soft" : "well")}
		style={{ gap: 2, padding: tone === "light" ? 2 : 3, borderRadius: "var(--radius)" }}
	>
		{options.map((option) => {
			const on = option.value === value
			return (
				<button
					key={option.value}
					type="button"
					aria-pressed={on}
					onClick={() => onChange(option.value)}
					className={clsx(
						"flex items-center whitespace-nowrap",
						on ? (tone === "light" ? "bg-panel text-ink" : "bg-primary text-white") : "text-muted hover:text-ink",
					)}
					style={{
						gap: 8,
						height: tone === "light" ? 30 : 28,
						padding: "0 12px",
						fontSize: tone === "light" ? 13 : 14,
						fontWeight: on && tone === "solid" ? 600 : 500,
					}}
				>
					{option.label}
					{option.count === undefined ? null : (
						<span
							className="font-mono opacity-70"
							style={{ fontSize: tone === "light" ? 11 : 12, fontVariantNumeric: "tabular-nums" }}
						>
							{option.count}
						</span>
					)}
				</button>
			)
		})}
	</div>
)
