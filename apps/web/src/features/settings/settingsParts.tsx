import { type ReactNode } from "react"

import { SectionLabel } from "@/components/mobile/primitives"

// Layout pieces the Settings pages share with the Notification Email settings (an ee feature).

export const SectionTitle = ({ children, id }: { children: ReactNode; id?: string }) => (
	<h2 id={id} className="font-display mt-0 mb-3.5 text-[24px] font-semibold tracking-[-.01em]">
		{children}
	</h2>
)

export const Card = ({ children }: { children: ReactNode }) => (
	<div className="overflow-hidden rounded-(--radius) border border-line-faint bg-white">{children}</div>
)

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
	<div className="flex items-center border-b border-line-pale px-6 last:border-b-0" style={{ gap: 20, minHeight: 56 }}>
		<div className="flex-none text-muted" style={{ width: 140, fontSize: 14 }}>
			{label}
		</div>
		<div className="flex min-w-0 flex-1 items-center" style={{ gap: 8, fontSize: 15 }}>
			{children}
		</div>
	</div>
)

/** Disables every control inside at once (a native `fieldset`), dimmed while it is. */
export const DisabledWhen = ({ disabled, children }: { disabled: boolean; children: ReactNode }) => (
	<fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0 disabled:opacity-50">
		{children}
	</fieldset>
)

/** The drawer-style section head, flush in the tab's padded column (W:L518). */
export const MobileLabel = ({ children, first = false }: { children: ReactNode; first?: boolean }) => (
	<SectionLabel style={{ padding: first ? "4px 0 8px" : "22px 0 8px" }}>{children}</SectionLabel>
)

/** A bordered group of rows, radius 10 as the design's cards (W:L514, L545). */
export const MobileCard = ({ children }: { children: ReactNode }) => (
	<div className="overflow-hidden border border-card-line" style={{ borderRadius: 10 }}>
		{children}
	</div>
)

/** One row of a Card: the label over its value, stacked for a phone's width. */
export const MobileField = ({
	label,
	children,
	trailing,
}: {
	label: string
	children: ReactNode
	trailing?: ReactNode
}) => (
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

/** The mobile switch row, styled as Security's "Redact by default"; `name` overrides its accessible name. */
export const MobileSwitchRow = ({
	on,
	label,
	hint,
	name,
	disabled = false,
	onToggle,
}: {
	on: boolean
	label: string
	hint: string
	name?: string
	disabled?: boolean
	onToggle: () => void
}) => (
	<button
		type="button"
		role="switch"
		aria-checked={on}
		aria-label={name}
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
		{/* Off is `control-edge`, for 3:1 against white (PRIMITIVES.md), as on Security. */}
		<span
			aria-hidden
			className={on ? "flex flex-none justify-end bg-ink" : "flex flex-none justify-start bg-control-edge"}
			style={{ width: 40, height: 24, borderRadius: 12, padding: 3, transition: "background 200ms" }}
		>
			<span className="bg-white" style={{ width: 18, height: 18, borderRadius: "50%" }} />
		</span>
	</button>
)
