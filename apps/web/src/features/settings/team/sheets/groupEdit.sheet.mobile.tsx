import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { useMe } from "@/features/auth/hooks/useMe"
import { GroupForm } from "@/features/settings/team/GroupForm.mobile"
import { useGroups } from "@/features/settings/team/hooks/useGroups"
import { useMembers } from "@/features/settings/team/hooks/useMembers"
import { sortTeam } from "@/features/settings/team/teamModel"

export default function GroupEditSheet({ params }: { params: SheetParams["groupEdit"] }) {
	const groups = useGroups()
	const members = useMembers()
	const youId = useMe().data?.id

	if (groups.isPending || members.isPending) return <SheetLoading title="Edit group" />
	const failure = groups.error ?? members.error
	if (!groups.data || !members.data) {
		return (
			<Sheet title="Edit group">
				<SheetNote role="alert">{failure?.message ?? "Could not load the group."}</SheetNote>
			</Sheet>
		)
	}
	const group = groups.data.view === "admin" ? groups.data.items.find((c) => c.id === params.groupId) : undefined
	if (!group) {
		return (
			<Sheet title="Edit group">
				<SheetNote>This group no longer exists.</SheetNote>
			</Sheet>
		)
	}
	return <GroupForm group={group} members={sortTeam(members.data.items, youId)} youId={youId} />
}
