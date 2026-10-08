import clsx from "clsx"
import { useId } from "react"

/**
 * The "Published version" options (T:L3442–3447): a square white card, `line-soft` border that turns ink when
 * selected or hovered, and a square 20px ring with a 10px dot.
 * The prototype draws a `<button>`; a real radio input carries the group semantics. The input
 * covers the whole card at `opacity:0` rather than being `sr-only`, so a pointer click and
 * Playwright's `.check()` land on the input instead of on the label. The description is tied on
 * with `aria-describedby` so it stays out of the radio's accessible name.
 */
export const RadioCard = ({
	name,
	value,
	checked,
	onSelect,
	label,
	description,
}: {
	name: string
	value: string
	checked: boolean
	onSelect: (value: string) => void
	label: string
	description: string
}) => {
	const id = useId()
	return (
		<label
			htmlFor={id}
			// Border colour stays in classes: an inline `border` would outrank the hover rule.
			className={clsx(
				"relative flex cursor-pointer items-start border bg-white text-left hover:border-ink",
				"has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
				checked ? "border-ink" : "border-line-soft",
			)}
			style={{ gap: 14, padding: "14px 16px", borderRadius: "var(--radius)" }}
		>
			<input
				id={id}
				type="radio"
				name={name}
				value={value}
				checked={checked}
				onChange={() => onSelect(value)}
				aria-label={label}
				aria-describedby={`${id}-description`}
				className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
			/>
			<span
				aria-hidden
				className="grid flex-none place-items-center"
				style={{
					width: 20,
					height: 20,
					border: `2px solid ${checked ? "var(--color-ink)" : "var(--color-control-edge)"}`,
					marginTop: 1,
				}}
			>
				<span style={{ width: 10, height: 10, background: checked ? "var(--color-ink)" : "transparent" }} />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block" style={{ fontSize: 15, fontWeight: 500 }}>
					{label}
				</span>
				<span
					id={`${id}-description`}
					className="block"
					style={{ fontSize: 13, color: "var(--color-muted)", marginTop: 2, lineHeight: 1.5 }}
				>
					{description}
				</span>
			</span>
		</label>
	)
}
