import { type ReactNode } from "react"

import { SectionLabel } from "@/components/mobile/primitives"

/** The drawer-style section head, flush in the tab's padded column. */
export const Label = ({ children, first = false }: { children: ReactNode; first?: boolean }) => (
	<SectionLabel style={{ padding: first ? "4px 0 8px" : "22px 0 8px" }}>{children}</SectionLabel>
)

export const SectionHead = ({
	children,
	count,
	action,
	first = false,
}: {
	children: ReactNode
	count?: number
	action?: ReactNode
	first?: boolean
}) => (
	<div className="flex items-center" style={{ gap: 12, marginTop: first ? 0 : 14 }}>
		<div className="min-w-0 flex-1">
			<Label first>
				{count === undefined ? (
					children
				) : (
					<>
						{children} · {count}
					</>
				)}
			</Label>
		</div>
		{action}
	</div>
)

/** A bordered group of rows, radius 10 as the design's cards. */
export const Card = ({ children }: { children: ReactNode }) => (
	<div className="overflow-hidden border border-card-line" style={{ borderRadius: 10 }}>
		{children}
	</div>
)

export const Field = ({ label, children, trailing }: { label: string; children: ReactNode; trailing?: ReactNode }) => (
	<div
		className="flex items-center border-b border-row-line last:border-b-0"
		style={{ gap: 8, minHeight: 58, padding: "8px 6px 8px 14px" }}
	>
		<div className="min-w-0 flex-1">
			<div className="text-muted" style={{ fontSize: 13 }}>
				{label}
			</div>
			<div className="truncate" style={{ fontSize: 15, marginTop: 2 }}>
				{children}
			</div>
		</div>
		{trailing}
	</div>
)

export const mobileInputClass = "w-full border border-line-soft bg-white px-3 outline-0 focus:border-ink"

export const SwitchRow = ({
	on,
	label,
	hint,
	ariaLabel,
	disabled = false,
	onToggle,
}: {
	on: boolean
	label: string
	hint: string
	ariaLabel?: string
	disabled?: boolean
	onToggle: () => void
}) => (
	<button
		type="button"
		role="switch"
		aria-checked={on}
		aria-label={ariaLabel}
		disabled={disabled}
		onClick={onToggle}
		className="flex w-full items-center border border-card-line text-left disabled:cursor-default disabled:opacity-50"
		style={{ gap: 14, padding: 14, borderRadius: 10 }}
	>
		<span className="flex-1">
			<span className="block" style={{ fontSize: 15, fontWeight: 500 }}>
				{label}
			</span>
			<span className="block text-muted" style={{ fontSize: 13, marginTop: 2, lineHeight: 1.45 }}>
				{hint}
			</span>
		</span>
		{/* Off is `control-edge`, for WCAG's 3:1 non-text contrast against white, as on Security. */}
		<span
			aria-hidden
			className={on ? "flex flex-none justify-end bg-ink" : "flex flex-none justify-start bg-control-edge"}
			style={{ width: 40, height: 24, borderRadius: 12, padding: 3, transition: "background 200ms" }}
		>
			<span className="bg-white" style={{ width: 18, height: 18, borderRadius: "50%" }} />
		</span>
	</button>
)
