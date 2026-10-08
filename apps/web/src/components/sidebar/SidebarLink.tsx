import clsx from "clsx"
import { Link, type LinkProps } from "react-router"

import type { CSSProperties, ReactNode } from "react"

type RowLook = {
	active?: boolean
	icon?: ReactNode
	trailing?: ReactNode
	className?: string
	children: ReactNode
}

const rowClass = (active: boolean, className?: string) =>
	clsx(
		"flex w-full flex-none items-center text-left text-body transition-colors duration-(--duration-row) ease-(--ease-arrive)",
		active ? "bg-nav-selected" : "bg-transparent hover:bg-hover",
		className,
	)

/** The selected item is the `nav-selected` fill at 500 (v3); there is no left bar. */
const rowStyle = (active: boolean): CSSProperties => ({
	gap: 10,
	height: 34,
	padding: "0 10px",
	fontSize: 14,
	fontWeight: active ? 500 : 400,
	borderRadius: "var(--radius)",
})

const RowContent = ({ icon, trailing, children }: Omit<RowLook, "active" | "className">) => (
	<>
		{icon}
		<span className="flex min-w-0 flex-1 items-center" style={{ gap: 6 }}>
			{children}
		</span>
		{trailing}
	</>
)

/**
 * One sidebar row that goes somewhere (T:L1760–1768): a real link, 34px, `0 10px`, a 10px gap, 14px body
 * text, 6px radius. Hover washes `hover`; the current row fills `nav-selected` at 500 and carries
 * `aria-current="page"`. `icon` sits in front of the label, `trailing` (a count,
 * a badge) after it.
 */
export const SidebarLink = ({
	active = false,
	icon,
	trailing,
	className,
	children,
	...rest
}: RowLook & Omit<LinkProps, "className" | "style" | "children">) => (
	<Link
		aria-current={active ? "page" : undefined}
		className={rowClass(active, className)}
		style={rowStyle(active)}
		{...rest}
	>
		<RowContent icon={icon} trailing={trailing}>
			{children}
		</RowContent>
	</Link>
)

/**
 * The mono count at the end of a row: Geist Mono 11px `muted`. Not `muted-2`, which falls under 4.5:1 on the
 * hover and selected fills (4.14 on `nav-selected`); `muted` holds 4.86 there.
 */
export const SidebarCount = ({ children }: { children: ReactNode }) => (
	<span className="font-mono text-muted" style={{ fontSize: 11 }}>
		{children}
	</span>
)
