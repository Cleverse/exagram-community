import clsx from "clsx"

import type { ButtonHTMLAttributes, CSSProperties } from "react"

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
	/**
	 * 32 = the header action and dialog close (T:L1745); 34 = v3's larger header and ghost icon button; 24 = the
	 * inline row action; 28 = the sidebar's logo row; 36 = the collapsed rail. Every size is square with the 6px control radius and the glyph
	 * centred.
	 */
	size?: 24 | 28 | 32 | 34 | 36
	style?: CSSProperties
}

export const IconButton = ({ size = 32, className, style, type = "button", children, ...rest }: IconButtonProps) => (
	<button
		type={type}
		className={clsx(
			"press grid flex-none place-items-center text-secondary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
			className,
		)}
		style={{ width: size, height: size, ...style }}
		{...rest}
	>
		{children}
	</button>
)
