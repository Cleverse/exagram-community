import { useState } from "react"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { useRemoveMember } from "@/features/settings/team/hooks/useMembers"
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
	const remove = useRemoveMember()
	const [ownsItems, setOwnsItems] = useState("projectCount" in target && target.projectCount > 0)
	const [successor, setSuccessor] = useState("")
	const candidates = members.filter((member) => member.id !== target.id)

	const confirm = () =>
		remove.mutate(
			{ userId: target.id, name: target.name, transferTo: ownsItems ? successor : undefined },
			{
				onSuccess: (result) => {
					if (result.removed) onClose()
					else setOwnsItems(true)
				},
			},
		)

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
					<Button
						variant="danger"
						size={40}
						disabled={remove.isPending || (ownsItems && successor === "")}
						onClick={confirm}
					>
						Remove
					</Button>
				</>
			}
		>
			<p className="m-0 text-secondary" style={{ fontSize: 15, lineHeight: 1.55 }}>
				{`${target.name} loses access to everything shared with them, and their connections are revoked. Access ends now; a file already open may stay readable for up to 5 minutes.`}
			</p>
			{ownsItems ? (
				<div className="flex flex-col" style={{ gap: 8 }}>
					<label htmlFor="remove-successor" style={{ fontSize: 14, fontWeight: 500 }}>
						Choose who takes over their files and folders
					</label>
					<select
						id="remove-successor"
						className="rounded-(--radius) border border-line-strong bg-white outline-0 focus:border-ink"
						style={{ height: 40, padding: "0 10px", fontSize: 15 }}
						value={successor}
						onChange={(event) => setSuccessor(event.target.value)}
					>
						<option value="" disabled>
							Choose a member
						</option>
						{candidates.map((member) => (
							<option key={member.id} value={member.id}>
								{member.id === youId ? `${member.name} (you)` : member.name}
							</option>
						))}
					</select>
				</div>
			) : null}
			{remove.error ? (
				<p role="alert" className="m-0 text-danger" style={{ fontSize: 14 }}>
					{remove.error.message}
				</p>
			) : null}
		</Dialog>
	)
}
