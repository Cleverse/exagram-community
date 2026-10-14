import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { useRemoveMemberFlow } from "@/features/settings/team/hooks/useRemoveMemberFlow"
import { removeMemberBody, SUCCESSOR_PLACEHOLDER, SUCCESSOR_PROMPT } from "@/features/settings/team/teamCopy"
import { type TeamMember } from "@/features/settings/team/teamModel"

export const RemoveMemberDialog = ({
	target,
	members,
	youId,
	onClose,
}: {
	target: TeamMember
	members: readonly TeamMember[]
	youId: string | undefined
	onClose: () => void
}) => {
	const flow = useRemoveMemberFlow(target, onClose)
	const candidates = members.filter((member) => member.id !== target.id)

	return (
		<Dialog
			title={`Remove ${target.name}?`}
			onClose={onClose}
			width={520}
			bodyGap={16}
			footer={
				<>
					<Button variant="outline" size={40} onClick={onClose}>
						Cancel
					</Button>
					<Button variant="danger" size={40} disabled={flow.blocked} onClick={flow.confirm}>
						Remove
					</Button>
				</>
			}
		>
			<p className="m-0 text-secondary" style={{ fontSize: 15, lineHeight: 1.55 }}>
				{removeMemberBody(target.name)}
			</p>
			{flow.ownsItems ? (
				<div className="flex flex-col" style={{ gap: 8 }}>
					<label htmlFor="remove-successor" style={{ fontSize: 14, fontWeight: 500 }}>
						{SUCCESSOR_PROMPT}
					</label>
					<select
						id="remove-successor"
						className="rounded-(--radius) border border-line-strong bg-white outline-0 focus:border-ink"
						style={{ height: 40, padding: "0 10px", fontSize: 15 }}
						value={flow.successor}
						onChange={(event) => flow.setSuccessor(event.target.value)}
					>
						<option value="" disabled>
							{SUCCESSOR_PLACEHOLDER}
						</option>
						{candidates.map((member) => (
							<option key={member.id} value={member.id}>
								{member.id === youId ? `${member.name} (you)` : member.name}
							</option>
						))}
					</select>
				</div>
			) : null}
			{flow.error ? (
				<p role="alert" className="m-0 text-danger" style={{ fontSize: 14 }}>
					{flow.error.message}
				</p>
			) : null}
		</Dialog>
	)
}
