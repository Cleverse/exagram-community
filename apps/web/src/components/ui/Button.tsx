import clsx from "clsx"
import { Children } from "react"

import type { ButtonHTMLAttributes, CSSProperties, Ref } from "react"

export type ButtonVariant = "primary" | "approve" | "quiet" | "outline" | "ghost" | "subtle" | "danger" | "dangerGhost"
/** 30 / 32 / 36 are Aura's button heights; 40 is the dialog footer and 44 the auth pages. */
export type ButtonSize = 30 | 32 | 36 | 40 | 44

/** Padding and type size per height, as the prototype writes them. */
const SIZE: Record<ButtonSize, { padding: string; fontSize: number }> = {
	30: { padding: "0 12px", fontSize: 13 },
	32: { padding: "0 12px", fontSize: 13 },
	36: { padding: "0 16px", fontSize: 14 },
	40: { padding: "0 16px", fontSize: 15 },
	44: { padding: "0 18px", fontSize: 15 },
}

/** The pressable, filled variants carry 600; the rest read as text, 500 (400 at the dialog's 40/44). */
const STRONG: Record<ButtonVariant, boolean> = {
	primary: true,
	approve: true,
	danger: true,
	dangerGhost: false,
	subtle: false,
	quiet: false,
	outline: false,
	ghost: false,
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
	// The primary action: near-black with white text — New, a dialog's confirm, Send.
	primary: "bg-primary text-white hover:bg-primary-hover",
	// Approve is the primary near-black too (plan decision 6); a separate name keeps the call sites readable.
	approve: "bg-primary text-white hover:bg-primary-hover",
	// Transparent until hovered.
	quiet: "text-secondary hover:bg-hover",
	// The secondary action: white with a 1px control border, e.g. Cancel.
	outline: "bg-white text-body shadow-plate hover:bg-hover",
	// Text only: no wash, the label darkens to ink.
	ghost: "text-muted hover:text-ink",
	// The soft fill: "Draft with AI", History. Hover and press step darker.
	subtle: "bg-chip text-body hover:bg-subtle active:bg-press",
	// A destructive confirm: dark red on the red tint.
	danger: "bg-danger-bg text-danger hover:bg-danger-hover",
	dangerGhost: "text-danger hover:bg-danger-bg",
}

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
	variant?: ButtonVariant
	size?: ButtonSize
	/** Flex gap between an icon and the label; the prototype varies it per call site. */
	gap?: number
	style?: CSSProperties
	ref?: Ref<HTMLButtonElement>
}

export const Button = ({
	variant = "primary",
	size = 36,
	gap = 8,
	className,
	style,
	type = "button",
	children,
	...rest
}: ButtonProps) => {
	const metrics = SIZE[size]
	// The prototype writes `display:flex` only on a button that holds an icon beside its label.
	// A text-only button is a plain block button: no `gap` and no `white-space` (Cancel).
	const row = Children.count(children) > 1
	return (
		<button
			type={type}
			className={clsx(
				"press disabled:cursor-not-allowed",
				"disabled:opacity-50",
				row && "flex items-center whitespace-nowrap",
				VARIANT_CLASS[variant],
				className,
			)}
			style={{
				...(row ? { gap } : {}),
				height: size,
				padding: metrics.padding,
				fontSize: metrics.fontSize,
				fontWeight: STRONG[variant] ? 600 : size >= 40 ? 400 : 500,
				...style,
			}}
			{...rest}
		>
			{children}
		</button>
	)
}
