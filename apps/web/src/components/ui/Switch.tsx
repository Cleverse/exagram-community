/**
 * The collaborator-overwrite toggle (T:L3436): a 6px-radius track, ink when on (no purple) and `control-edge` when off
 * (3.48:1 against white, 3.36:1 on the dialog surface; WCAG 1.4.11 asks 3:1),
 * with a white knob rounded to sit inside it. Track and knob move over the press duration on the arrival curve.
 */
const SIZES = {
	md: { width: 48, height: 28, knob: 22, knobTop: 3, offLeft: 3, onLeft: 23, marginTop: 2 },
	sm: { width: 32, height: 18, knob: 14, knobTop: 2, offLeft: 2, onLeft: 16, marginTop: 0 },
}

export const Switch = ({
	checked,
	onChange,
	label,
	id,
	size = "md",
}: {
	checked: boolean
	onChange: (next: boolean) => void
	/** Accessible name when the control sits next to a title rather than a `<label>`. */
	label?: string
	id?: string
	size?: "sm" | "md"
}) => {
	const dim = SIZES[size]
	return (
		<button
			type="button"
			id={id}
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
			className="relative flex-none"
			style={{
				width: dim.width,
				height: dim.height,
				background: checked ? "var(--color-ink)" : "var(--color-control-edge)",
				marginTop: dim.marginTop,
				transition: "background var(--duration-press) var(--ease-arrive)",
			}}
		>
			<span
				className="absolute"
				style={{
					top: dim.knobTop,
					left: checked ? dim.onLeft : dim.offLeft,
					width: dim.knob,
					height: dim.knob,
					background: "white",
					borderRadius: `calc(var(--radius) - ${dim.knobTop}px)`,
					boxShadow: "var(--shadow-knob)",
					transition: "left var(--duration-press) var(--ease-arrive)",
				}}
			/>
		</button>
	)
}
