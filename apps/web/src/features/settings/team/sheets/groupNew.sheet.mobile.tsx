import { Sheet } from "@/components/mobile/sheet/Sheet"
import { SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { useMe } from "@/features/auth/hooks/useMe"
import { GroupForm } from "@/features/settings/team/GroupForm.mobile"
import { useMembers } from "@/features/settings/team/hooks/useMembers"
import { sortTeam } from "@/features/settings/team/teamModel"

export default function GroupNewSheet() {
	const members = useMembers()
	const youId = useMe().data?.id

	if (members.isPending) return <SheetLoading title="New group" />
	if (!members.data) {
		return (
			<Sheet title="New group">
				<SheetNote role="alert">{members.error?.message ?? "Could not load the members."}</SheetNote>
			</Sheet>
		)
	}
	return <GroupForm group={undefined} members={sortTeam(members.data.items, youId)} youId={youId} />
}
