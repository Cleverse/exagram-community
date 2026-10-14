import { FILLS } from "@/features/library/avatarFills"
import { initialsOf } from "@/utils/initials"

const SHOWN = 3

/**
 * The shared-with stack before Present: up to three round 26px avatars overlapping by 8px on a 2px
 * white ring, then a `+N` chip. Hover names everyone; a click opens Share. It stays out of the header when
 * only one person can open the file.
 */
export const SharedAvatars = ({ people, onClick }: { people: string[]; onClick: () => void }) => {
	if (people.length < 2) return null
	const label = `Shared with ${people.join(", ")}`
	const extra = people.length - SHOWN

	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="press flex flex-none items-center hover:bg-hover"
			style={{ height: 32, padding: "0 4px", marginRight: 2, borderRadius: "var(--radius)" }}
		>
			{people.slice(0, SHOWN).map((name, index) => {
				const [background, color] = FILLS[index % FILLS.length] ?? FILLS[0]!
				return (
					<span
						key={name}
						aria-hidden
						title={name}
						className="font-mono grid place-items-center"
						style={{
							width: 26,
							height: 26,
							boxSizing: "content-box",
							border: "2px solid white",
							borderRadius: "50%",
							marginLeft: index === 0 ? 0 : -8,
							background,
							color,
							fontSize: 10,
							fontWeight: 600,
						}}
					>
						{initialsOf(name, undefined)}
					</span>
				)
			})}
			{extra > 0 ? (
				<span
					aria-hidden
					className="font-mono grid place-items-center bg-subtle text-secondary"
					style={{
						width: 26,
						height: 26,
						boxSizing: "content-box",
						border: "2px solid white",
						borderRadius: "50%",
						marginLeft: -8,
						fontSize: 10,
						fontWeight: 600,
					}}
				>
					+{extra}
				</span>
			) : null}
		</button>
	)
}
