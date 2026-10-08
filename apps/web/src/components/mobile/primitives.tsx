import clsx from "clsx"
import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react"
import { useNavigate } from "react-router"

import { IconCheck, IconChevronLeft, IconChevronRight, IconPlus } from "@/components/ui/icons"

/**
 * The mobile web building blocks, values from `docs/design/exagram-mobile/Exagram Mobile Web.dc.html` (W:Lnn).
 * Tertiary text uses `muted-2` rather than the prototype's #969AAA, and labels `label` rather than #9A9EAC,
 * for the same WCAG AA reason as desktop (PRIMITIVES.md).
 */

/** A 44px square icon button in a header: the hamburger, bell, search, Share, More (W:L57, L64–66, L206–207). */
export const HeaderIconButton = ({
	label,
	className,
	children,
	...rest
}: { label: string; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">) => (
	<button
		type="button"
		aria-label={label}
		className={clsx("relative grid flex-none place-items-center text-secondary active:bg-hover", className)}
		style={{ width: 44, height: 44 }}
		{...rest}
	>
		{children}
	</button>
)

/**
 * A pushed screen's 56px header (W:L72–76, L203–207, L255–259). Back shows `backLabel` beside the chevron, or
 * just the chevron when there is none. `title` centres a title; `center` fills the middle instead (the reading
 * view's file name over its folder); `actions` sit on the right.
 *
 * Back goes up to `to`, the screen's parent, never through browser history: history depends on how the person
 * arrived and is empty for a link opened cold, so the same button would go somewhere different each time.
 * The browser's own Back still walks history.
 */
export const PushHeader = ({
	to,
	backLabel,
	title,
	center,
	actions,
}: {
	to: string
	backLabel?: string
	title?: string
	center?: ReactNode
	actions?: ReactNode
}) => {
	const navigate = useNavigate()
	const back = () => void navigate(to)
	return (
		<div
			className="relative flex flex-none items-center border-b border-row-line bg-white"
			style={{ height: 56, padding: "0 8px", gap: 2 }}
		>
			{backLabel ? (
				<button
					type="button"
					onClick={back}
					className="flex min-w-0 items-center text-body active:bg-hover"
					style={{ height: 44, padding: "0 10px 0 4px", gap: 2, fontSize: 15 }}
				>
					<IconChevronLeft size={22} />
					<span className="truncate" style={{ maxWidth: 150 }}>
						{backLabel}
					</span>
				</button>
			) : (
				<HeaderIconButton label="Back" onClick={back} className="text-body">
					<IconChevronLeft size={22} />
				</HeaderIconButton>
			)}
			{title ? (
				<div
					className="pointer-events-none absolute truncate text-center"
					style={{ left: 120, right: 120, fontSize: 16, fontWeight: 600 }}
				>
					{title}
				</div>
			) : null}
			<div className="flex min-w-0 flex-1 items-center">{center}</div>
			{actions}
		</div>
	)
}

/**
 * A screen inside the mobile shell: an optional fixed header, a body that scrolls on its own, and an optional
 * floating action. `push` plays the pushed-screen arrival (slide 32px and fade, 280ms; W:L71).
 */
export const MobileScreen = ({
	header,
	children,
	fab,
	push = false,
	label,
	bodyStyle,
	bleed = false,
}: {
	header?: ReactNode
	children: ReactNode
	fab?: ReactNode
	push?: boolean
	label?: string
	bodyStyle?: CSSProperties
	/**
	 * The body runs to the very bottom of the screen, under iOS 26 Safari's floating toolbar, with no room left
	 * to scroll its end clear of it: the reading view's HTML frame, which scrolls inside itself.
	 */
	bleed?: boolean
}) => (
	<div
		aria-label={label}
		className="relative flex h-full min-h-0 flex-col"
		style={push ? { animation: "m-push 280ms var(--ease-arrive)" } : undefined}
	>
		{header}
		<div className="min-h-0 flex-1 overflow-y-auto" style={bodyStyle}>
			{children}
			{/* The bottom inset (the toolbar or home indicator) as scroll room, so the last row clears it. */}
			{bleed ? null : <div aria-hidden className="flex-none" style={{ height: "env(safe-area-inset-bottom)" }} />}
		</div>
		{fab}
	</div>
)

/** The uppercase section label: PINNED, PROJECTS, PEOPLE WITH ACCESS (W:L138, L160). */
export const SectionLabel = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
	<div
		className="text-label"
		style={{
			padding: "14px 16px 4px",
			fontSize: 11,
			fontWeight: 600,
			letterSpacing: ".06em",
			textTransform: "uppercase",
			...style,
		}}
	>
		{children}
	</div>
)

/** A day heading in a list: Today, Yesterday, Earlier this week (W:L186). */
export const GroupLabel = ({ children }: { children: ReactNode }) => (
	<div className="text-muted-2" style={{ padding: "18px 10px 4px", fontSize: 13, fontWeight: 500 }}>
		{children}
	</div>
)

/**
 * The dark filter chips: All / Shared with me / My uploads with a Geist Mono count (W:L131–134, README:
 * `#171923`/`#fff` on, `#F2F2F6` off, 34px, radius 6).
 */
export const FilterChips = <T extends string>({
	label,
	options,
	value,
	onChange,
}: {
	label: string
	options: { value: T; label: string; count?: number }[]
	value: T
	onChange: (value: T) => void
}) => (
	<div
		role="tablist"
		aria-label={label}
		className="flex flex-none overflow-x-auto"
		style={{ gap: 8, padding: "12px 16px 10px" }}
	>
		{options.map((option) => {
			const on = option.value === value
			return (
				<button
					key={option.value}
					type="button"
					role="tab"
					aria-selected={on}
					onClick={() => onChange(option.value)}
					className={clsx(
						"flex flex-none items-center whitespace-nowrap",
						on ? "bg-ink text-white" : "bg-row-selected text-body active:bg-press",
					)}
					style={{ height: 34, padding: "0 12px", gap: 6, fontSize: 14, fontWeight: 500 }}
				>
					{option.label}
					{option.count === undefined ? null : (
						<span className="font-mono" style={{ fontSize: 12, opacity: on ? 0.7 : 0.6 }}>
							{option.count}
						</span>
					)}
				</button>
			)
		})}
	</div>
)

/** The 2-up segmented toggle: Mine / Team, Latest / Pinned (W:L78–81). */
export const Segmented = <T extends string>({
	label,
	options,
	value,
	onChange,
}: {
	label: string
	options: { value: T; label: string }[]
	value: T
	onChange: (value: T) => void
}) => (
	<div
		role="radiogroup"
		aria-label={label}
		className="grid border border-line-segment"
		style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)`, padding: 2, borderRadius: 8 }}
	>
		{options.map((option) => {
			const on = option.value === value
			return (
				<button
					key={option.value}
					type="button"
					role="radio"
					aria-checked={on}
					onClick={() => onChange(option.value)}
					className={on ? "bg-ink text-white" : "text-secondary"}
					style={{ height: 34, fontSize: 14, fontWeight: on ? 600 : 500 }}
				>
					{option.label}
				</button>
			)
		})}
	</div>
)

/** The floating dark "New" button, 48px, radius 10 (W:L197). */
export const NewFab = ({ onClick, label = "New" }: { onClick: () => void; label?: string }) => (
	<button
		type="button"
		onClick={onClick}
		className="absolute flex items-center bg-ink text-white active:bg-primary-hover"
		style={{
			right: 16,
			bottom: "max(20px, env(safe-area-inset-bottom))",
			height: 48,
			padding: "0 18px 0 14px",
			borderRadius: 10,
			gap: 8,
			fontSize: 15,
			fontWeight: 500,
			boxShadow: "0 8px 30px rgba(20,20,40,.22)",
		}}
	>
		<IconPlus size={18} />
		{label}
	</button>
)

/** A 48px drawer row (W:L640–648): icon, label with an optional sub line, and a value, check or chevron. */
export const SheetRow = ({
	icon,
	label,
	sub,
	value,
	check = false,
	chevron = false,
	danger = false,
	disabled = false,
	onClick,
}: {
	icon?: ReactNode
	label: string
	sub?: string
	value?: string
	check?: boolean
	chevron?: boolean
	danger?: boolean
	disabled?: boolean
	onClick: () => void
}) => (
	<button
		type="button"
		onClick={onClick}
		disabled={disabled}
		className={clsx(
			"flex w-full items-center text-left disabled:opacity-50",
			danger ? "text-danger active:bg-danger-bg" : "text-ink active:bg-hover",
		)}
		style={{ gap: 12, minHeight: 48, padding: "6px 10px" }}
	>
		{icon ? (
			<span
				className={clsx("grid flex-none place-items-center", danger ? "text-danger" : "text-secondary")}
				style={{ width: 18 }}
			>
				{icon}
			</span>
		) : null}
		<span className="min-w-0 flex-1">
			<span className="block truncate" style={{ fontSize: 15 }}>
				{label}
			</span>
			{sub ? (
				<span className="block text-muted-2" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
					{sub}
				</span>
			) : null}
		</span>
		{value ? (
			<span className="truncate text-muted-2" style={{ fontSize: 13.5, maxWidth: 120 }}>
				{value}
			</span>
		) : null}
		{check ? <IconCheck size={17} className="text-ink" /> : null}
		{chevron ? <IconChevronRight size={15} className="text-path-slash" /> : null}
	</button>
)

/** The rows' container and the hairline between groups of rows (W:L637, L639). */
export const SheetRows = ({ children }: { children: ReactNode }) => (
	<div style={{ padding: "0 6px 8px" }}>{children}</div>
)

export const SheetSeparator = () => <div className="bg-row-line" style={{ height: 1, margin: "6px 10px" }} />
