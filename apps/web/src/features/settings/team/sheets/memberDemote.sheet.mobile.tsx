import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { edition } from "@/edition/edition"
import { ConfirmPanel, SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { useMembers, useSetMemberRole } from "@/features/settings/team/hooks/useMembers"
import { DEMOTE_CONFIRM, DEMOTE_TITLE } from "@/features/settings/team/teamCopy"

export default function MemberDemoteSheet({ params }: { params: SheetParams["memberDemote"] }) {
	const sheet = useSheet()
	const members = useMembers()
	const setRole = useSetMemberRole()

	if (members.isPending) return <SheetLoading title={DEMOTE_TITLE} />
	const member = members.data?.items.find((candidate) => candidate.id === params.userId)
	if (!member) {
		return (
			<Sheet title={DEMOTE_TITLE}>
				<SheetNote role={members.isError ? "alert" : undefined}>
					{members.isError ? members.error.message : "They are no longer in this Workspace."}
				</SheetNote>
			</Sheet>
		)
	}

	return (
		<Sheet title={DEMOTE_TITLE}>
			<ConfirmPanel
				message={edition.copy.demoteYourself}
				confirmLabel={DEMOTE_CONFIRM}
				busyLabel="Saving…"
				busy={setRole.isPending}
				onCancel={sheet.back}
				onConfirm={() =>
					setRole.mutate({ userId: member.id, name: member.name, role: "member" }, { onSuccess: sheet.close })
				}
			/>
		</Sheet>
	)
}
