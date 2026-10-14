import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { ConfirmPanel, SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { useDeleteGroup, useGroups } from "@/features/settings/team/hooks/useGroups"
import { DELETE_GROUP_BODY } from "@/features/settings/team/teamCopy"

export default function GroupDeleteSheet({ params }: { params: SheetParams["groupDelete"] }) {
	const sheet = useSheet()
	const groups = useGroups()
	const remove = useDeleteGroup()

	if (groups.isPending) return <SheetLoading title="Delete group" />
	const group = groups.data?.items.find((candidate) => candidate.id === params.groupId)
	if (!group) {
		return (
			<Sheet title="Delete group">
				<SheetNote role={groups.isError ? "alert" : undefined}>
					{groups.isError ? groups.error.message : "This group no longer exists."}
				</SheetNote>
			</Sheet>
		)
	}

	return (
		<Sheet title={`Delete ${group.name}?`} wrapTitle>
			<ConfirmPanel
				message={DELETE_GROUP_BODY}
				confirmLabel="Delete group"
				busy={remove.isPending}
				onCancel={sheet.back}
				onConfirm={() => remove.mutate({ id: group.id, name: group.name }, { onSuccess: sheet.close })}
			/>
		</Sheet>
	)
}
