import { Button } from "@/components/ui/Button"
import { IconButton } from "@/components/ui/IconButton"
import { IconClose } from "@/components/ui/icons"
import { type InviteRole, type useInvites } from "@/features/settings/hooks/useInvites"
import { isInviteEmail } from "@/features/settings/team/teamModel"

const controlClass =
	"min-w-0 rounded-(--radius) border border-line-strong bg-white text-[15px] outline-0 focus:border-ink"

export const InvitePanel = ({
	invites,
	domain,
	emailed,
	canChooseRole,
	onClose,
}: {
	invites: ReturnType<typeof useInvites>
	domain: string | null
	emailed: boolean
	canChooseRole: boolean
	onClose: () => void
}) => (
	<form
		aria-label="Invite member"
		onSubmit={invites.submit}
		onKeyDown={(event) => {
			if (event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) onClose()
		}}
		className="flex items-center rounded-(--radius) border border-line bg-white"
		style={{ gap: 10, marginTop: 22, padding: 14, animation: "fadeUp var(--duration-panel) var(--ease-arrive)" }}
	>
		<label htmlFor="team-invite-email" className="sr-only">
			Email
		</label>
		<input
			id="team-invite-email"
			type="email"
			autoFocus
			placeholder={`name@${domain ?? "example.com"}`}
			className={`${controlClass} flex-1`}
			style={{ height: 44, padding: "0 14px" }}
			value={invites.email}
			onChange={(event) => invites.setEmail(event.target.value)}
		/>
		{canChooseRole ? (
			<>
				<label htmlFor="team-invite-role" className="sr-only">
					Role
				</label>
				<select
					id="team-invite-role"
					className={controlClass}
					style={{ height: 44, padding: "0 12px" }}
					value={invites.role}
					onChange={(event) => invites.setRole(event.target.value as InviteRole)}
				>
					<option value="member">Member</option>
					<option value="admin">Admin</option>
				</select>
			</>
		) : null}
		<Button
			type="submit"
			size={44}
			disabled={invites.create.isPending || !isInviteEmail(invites.email)}
			className="whitespace-nowrap"
		>
			{emailed ? "Send invite" : "Create invite link"}
		</Button>
		<IconButton size={36} title="Close" aria-label="Close invite" onClick={onClose}>
			<IconClose size={16} />
		</IconButton>
	</form>
)
