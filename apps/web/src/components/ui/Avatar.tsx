import clsx from "clsx"

import type { CSSProperties } from "react"

/**
 * Geist Mono 500 initials on a 6px-radius square: v3's person avatars (Share's people P:3029 and P:3067, the
 * Activity actors P:1708). `square` drops the radius for the account avatar, which v3 draws sharp (P:1542,
 * P:1556). The default is 32px ink with white 12px initials; the collapsed rail passes brand purple, one of
 * the three places purple appears. 26px in list rows.
 */
export const Avatar = ({
	initials,
	size = 32,
	background = "var(--color-ink)",
	color = "white",
	fontSize,
	square = false,
	className,
	style,
	title,
}: {
	initials: string
	size?: number
	background?: string
	color?: string
	fontSize?: number
	/** The account avatar's sharp corners. */
	square?: boolean
	className?: string
	style?: CSSProperties
	/** The full name, shown on hover and read out in place of the initials. */
	title?: string
}) => (
	<div
		title={title}
		role={title ? "img" : undefined}
		aria-label={title}
		className={clsx("grid place-items-center font-mono", className)}
		style={{
			width: size,
			height: size,
			background,
			color,
			borderRadius: square ? 0 : "var(--radius)",
			fontWeight: 500,
			fontSize: fontSize ?? (size >= 32 ? 12 : 9),
			...style,
		}}
	>
		{initials}
	</div>
)

/**
 * The 64px avatar slot on a list row: 26px neutral squares with a `2px var(--color-ground)`
 * ring, `gap:3px` and `margin-left:-6px`, right-aligned.
 */
export const AvatarStack = ({ people, className }: { people: string[]; className?: string }) => (
	<div className={clsx("flex flex-none justify-end", className)} style={{ gap: 3, width: 64 }}>
		{people.map((initials, index) => (
			<Avatar
				key={`${initials}-${index}`}
				initials={initials}
				size={26}
				background="var(--color-row-line)"
				color="var(--color-ink)"
				style={{ border: "2px solid var(--color-ground)", marginLeft: -6 }}
			/>
		))}
	</div>
)
