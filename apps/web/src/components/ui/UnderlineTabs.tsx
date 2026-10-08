import clsx from "clsx"

import type { CSSProperties, KeyboardEvent, ReactNode } from "react"

const SIZE = {
	sm: { gap: 18, labelGap: 6, height: 30, padding: 0, fontSize: 13, idleWeight: 500, countSize: 11 },
	md: { gap: 18, labelGap: 6, height: 32, padding: 0, fontSize: 14, idleWeight: 500, countSize: 11 },
	lg: { gap: 4, labelGap: 8, height: 40, padding: "0 12px", fontSize: 15, idleWeight: 400, countSize: 12 },
} as const

/**
 * Aura's underline tabs: the sidebar section tabs (T:L1748, `navTabs` T:L4476) and the Mine / Shared scope
 * tabs (T:L1834). An 18px gap, a full-width 1px base line, and the active tab drawn with
 * `inset 0 -2px 0` ink at 600; inactive tabs are 500 muted. Only the colour and underline transition.
 *
 * `size="md"` is the 32px, 14px section row; `size="sm"` is the 30px, 13px scope row, where a tab may
 * carry a Geist Mono count.
 *
 * Keyboard follows the ARIA tabs pattern with automatic activation: the selected tab is the one Tab stop,
 * and Arrow Left/Right, Home and End move focus and select as they go. `panelId` sets `aria-controls`.
 */
export const UnderlineTabs = <T extends string>({
	tabs,
	value,
	onChange,
	ariaLabel,
	size = "md",
	className,
	style,
}: {
	tabs: { value: T; label: string; count?: ReactNode; badge?: { value: number; label: string }; panelId?: string }[]
	value: T
	onChange: (next: T) => void
	ariaLabel?: string
	size?: "md" | "sm" | "lg"
	className?: string
	style?: CSSProperties
}) => {
	const metrics = SIZE[size]
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const index = tabs.findIndex((tab) => tab.value === value)
		const next =
			event.key === "ArrowRight"
				? (index + 1) % tabs.length
				: event.key === "ArrowLeft"
					? (index - 1 + tabs.length) % tabs.length
					: event.key === "Home"
						? 0
						: event.key === "End"
							? tabs.length - 1
							: null
		const target = next === null ? undefined : tabs[next]
		if (next === null || target === undefined) return
		event.preventDefault()
		onChange(target.value)
		event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
	}

	return (
		<div
			role="tablist"
			aria-label={ariaLabel}
			onKeyDown={onKeyDown}
			className={clsx("relative flex", className)}
			style={{ gap: metrics.gap, ...style }}
		>
			<div
				aria-hidden
				className="absolute inset-x-0 bottom-0"
				style={{ height: 1, background: "var(--color-pane-line)" }}
			/>
			{tabs.map((tab, index) => {
				const on = tab.value === value
				// With no selected tab the first one takes the Tab stop, so the tablist stays reachable.
				const tabbable = on || (index === 0 && !tabs.some((other) => other.value === value))
				return (
					<button
						key={tab.value}
						type="button"
						role="tab"
						aria-selected={on}
						aria-controls={tab.panelId}
						tabIndex={tabbable ? 0 : -1}
						onClick={() => onChange(tab.value)}
						className={clsx(
							"relative flex items-center whitespace-nowrap",
							on ? "text-ink" : "text-muted hover:text-ink",
						)}
						style={{
							gap: metrics.labelGap,
							height: metrics.height,
							padding: metrics.padding,
							fontSize: metrics.fontSize,
							fontWeight: on ? 600 : metrics.idleWeight,
							boxShadow: on ? "inset 0 -2px 0 var(--color-ink)" : "inset 0 -2px 0 transparent",
							// A tab is drawn by its underline, so it stays square under the 6px control radius.
							borderRadius: 0,
							transition:
								"color var(--duration-tab) var(--ease-arrive), box-shadow var(--duration-tab) var(--ease-arrive)",
						}}
					>
						{tab.label}
						{tab.badge !== undefined ? (
							<>
								<span
									aria-hidden
									className="grid place-items-center bg-pending font-mono text-white"
									style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, fontSize: 12, fontWeight: 600 }}
								>
									{tab.badge.value}
								</span>
								<span className="sr-only">{tab.badge.label}</span>
							</>
						) : tab.count === undefined ? null : (
							<span className="font-mono text-muted" style={{ fontSize: metrics.countSize }}>
								{tab.count}
							</span>
						)}
					</button>
				)
			})}
		</div>
	)
}
