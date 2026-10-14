import { useId } from "react"

import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { ConfirmPanel, SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { useMe } from "@/features/auth/hooks/useMe"
import { useMembers } from "@/features/settings/team/hooks/useMembers"
import { useRemoveMemberFlow } from "@/features/settings/team/hooks/useRemoveMemberFlow"
import { sheetFieldClass, sheetFieldStyle } from "@/features/settings/team/sheets/sheetField"
import { FieldLabel, FormError } from "@/features/settings/team/sheets/teamSheetParts"
import { removeMemberBody, SUCCESSOR_PLACEHOLDER, SUCCESSOR_PROMPT } from "@/features/settings/team/teamCopy"
import { sortTeam, type TeamMember } from "@/features/settings/team/teamModel"

const RemoveBody = ({ target, members, youId }: { target: TeamMember; members: TeamMember[]; youId?: string }) => {
	const sheet = useSheet()
	const flow = useRemoveMemberFlow(target, sheet.close)
	const successorId = useId()

	return (
		<Sheet title={`Remove ${target.name}?`} wrapTitle>
			<ConfirmPanel
				message={removeMemberBody(target.name)}
				confirmLabel="Remove"
				busyLabel="Removing…"
				busy={flow.pending}
				confirmDisabled={flow.blocked}
				onCancel={sheet.back}
				onConfirm={flow.confirm}
			>
				{flow.ownsItems ? (
					<div className="flex flex-col" style={{ gap: 6, marginTop: 14 }}>
						<FieldLabel htmlFor={successorId}>{SUCCESSOR_PROMPT}</FieldLabel>
						<select
							id={successorId}
							className={sheetFieldClass}
							style={sheetFieldStyle}
							value={flow.successor}
							onChange={(event) => flow.setSuccessor(event.target.value)}
						>
							<option value="" disabled>
								{SUCCESSOR_PLACEHOLDER}
							</option>
							{sortTeam(members, youId)
								.filter((member) => member.id !== target.id)
								.map((member) => (
									<option key={member.id} value={member.id}>
										{member.id === youId ? `${member.name} (you)` : member.name}
									</option>
								))}
						</select>
					</div>
				) : null}
				{flow.error ? (
					<div style={{ marginTop: 12 }}>
						<FormError>{flow.error.message}</FormError>
					</div>
				) : null}
			</ConfirmPanel>
		</Sheet>
	)
}

export default function MemberRemoveSheet({ params }: { params: SheetParams["memberRemove"] }) {
	const members = useMembers()
	const youId = useMe().data?.id
	if (members.isPending) return <SheetLoading title="Remove" />
	const target = members.data?.items.find((candidate) => candidate.id === params.userId)
	if (!members.data || !target) {
		return (
			<Sheet title="Remove">
				<SheetNote role={members.isError ? "alert" : undefined}>
					{members.isError ? members.error.message : "They are no longer in this Workspace."}
				</SheetNote>
			</Sheet>
		)
	}
	return <RemoveBody target={target} members={members.data.items} youId={youId} />
}
