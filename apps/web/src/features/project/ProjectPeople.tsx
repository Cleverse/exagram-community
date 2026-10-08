import { type VisibleProject } from "@exagram/api-client"

import { Avatar } from "@/components/ui/Avatar"
import { FILLS } from "@/features/library/avatarFills"
import { initialsOf } from "@/utils/initials"

const SHOWN = 3

const Label = ({ children }: { children: string }) => (
	<span className="text-muted" style={{ fontSize: 13 }}>
		{children}
	</span>
)

/** Round 22px initials on a 2px white ring; hover names the person. */
const Face = ({
	name,
	initials = initialsOf(name, undefined),
	background,
	color,
	overlap,
}: {
	name: string
	initials?: string
	background: string
	color: string
	overlap: boolean
}) => (
	<Avatar
		initials={initials}
		title={name}
		size={22}
		background={background}
		color={color}
		style={{
			boxSizing: "content-box",
			border: "2px solid var(--color-ground)",
			borderRadius: "50%",
			marginLeft: overlap ? -6 : 0,
		}}
	/>
)

/**
 * Who a Project belongs to and who else reaches it, beside its rules chip: the Owner by name, then up to three
 * members and a head count that includes the Owner. The Access group opens Share.
 */
export const ProjectPeople = ({
	project,
	meId,
	onOpenShare,
}: {
	project: VisibleProject
	meId: string | undefined
	onOpenShare: () => void
}) => {
	// An API released before the list named people sends neither field; show nothing rather than crash.
	if (project.ownerName === undefined) return null
	const members = project.memberNames ?? null
	const owner = (
		<div className="flex min-w-0 items-center" style={{ gap: 8 }}>
			<Label>Owner</Label>
			<Face name={project.ownerName} background="var(--color-ink)" color="white" overlap={false} />
			<span className="min-w-0 truncate" style={{ fontSize: 13 }}>
				{project.ownerId === meId ? `${project.ownerName} (you)` : project.ownerName}
			</span>
		</div>
	)
	// A Viewer may not read who else is on the Project, so the list sends them no members and Access stays out.
	if (members === null) return <div className="flex min-w-0 items-center">{owner}</div>

	const total = members.length + 1
	const extra = members.length - SHOWN
	// Only the Owner is ever alone on a Project they can see, so one person is always "you".
	const count = total === 1 ? "Only you" : `${total} people`

	return (
		<div className="flex min-w-0 flex-wrap items-center" style={{ gap: "8px 16px" }}>
			{owner}

			<button
				type="button"
				onClick={onOpenShare}
				aria-label={`Access: ${count}. Open Share`}
				className="press flex items-center hover:bg-hover"
				style={{ gap: 8, height: 28, padding: "0 6px", margin: "0 -6px", borderRadius: "var(--radius)" }}
			>
				<Label>Access</Label>
				{members.length > 0 ? (
					<span className="flex items-center">
						{members.slice(0, SHOWN).map((name, index) => {
							const [background, color] = FILLS[index % FILLS.length] ?? FILLS[0]!
							return (
								<Face key={`${name}-${index}`} name={name} background={background} color={color} overlap={index > 0} />
							)
						})}
						{extra > 0 ? (
							<Face
								name={members.slice(SHOWN).join(", ")}
								initials={`+${extra}`}
								background="var(--color-subtle)"
								color="var(--color-secondary)"
								overlap
							/>
						) : null}
					</span>
				) : null}
				<span style={{ fontSize: 13 }}>{count}</span>
			</button>
		</div>
	)
}
