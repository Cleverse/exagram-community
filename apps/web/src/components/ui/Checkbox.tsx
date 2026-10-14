import { IconCheck } from "@/components/ui/icons"

export const Checkbox = ({
	checked,
	onChange,
	ariaLabel,
	disabled = false,
}: {
	checked: boolean
	onChange: (next: boolean) => void
	ariaLabel?: string
	disabled?: boolean
}) => (
	<span
		className="relative grid flex-none place-items-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink"
		style={{
			width: 18,
			height: 18,
			borderRadius: 4,
			border: `1.5px solid ${checked ? "var(--color-ink)" : "var(--color-control-edge)"}`,
			background: checked ? "var(--color-ink)" : "white",
			transition:
				"background var(--duration-press) var(--ease-arrive), border-color var(--duration-press) var(--ease-arrive)",
		}}
	>
		<input
			type="checkbox"
			checked={checked}
			disabled={disabled}
			aria-label={ariaLabel}
			onChange={(event) => onChange(event.target.checked)}
			className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
		/>
		<IconCheck
			size={12}
			strokeWidth={3}
			className="pointer-events-none text-white"
			style={{ opacity: checked ? 1 : 0 }}
			aria-hidden
		/>
	</span>
)
