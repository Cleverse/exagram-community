import { type AdminGroup, type Group } from "@exagram/api-client"
import { useState } from "react"

import { Button } from "@/components/ui/Button"
import { IconPlus } from "@/components/ui/icons"
import { SectionLabel } from "@/components/ui/Mono"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { useMe } from "@/features/auth/hooks/useMe"
import { DeleteGroupDialog } from "@/features/settings/team/DeleteGroupDialog"
import { GroupModal } from "@/features/settings/team/GroupModal"
import { GroupRow } from "@/features/settings/team/GroupRow"
import { useGroups } from "@/features/settings/team/hooks/useGroups"
import { useMembers } from "@/features/settings/team/hooks/useMembers"
import { GROUPS_INTRO, groupsEmpty } from "@/features/settings/team/teamCopy"
import { MAX_GROUP_AVATARS, membersIn, sortTeam } from "@/features/settings/team/teamModel"

type Editing = { kind: "new" } | { kind: "edit"; group: AdminGroup }

export const GroupsTab = () => {
	const youId = useMe().data?.id
	const groups = useGroups()
	const members = useMembers()
	const [editing, setEditing] = useState<Editing | null>(null)
	const [deleting, setDeleting] = useState<Group | null>(null)

	const failure = groups.error ?? members.error
	if (failure) {
		return (
			<p role="alert" className="m-0 text-danger" style={{ fontSize: 14, marginTop: 28 }}>
				{failure.message}
			</p>
		)
	}
	const list = groups.data
	if (list === undefined || members.data === undefined) {
		return (
			<SkeletonStatus label="Loading groups…">
				<Skeleton height={240} style={{ marginTop: 28 }} />
			</SkeletonStatus>
		)
	}
	const team = sortTeam(members.data.items, youId)

	return (
		<>
			<div className="flex flex-wrap items-center" style={{ gap: 12, marginTop: 28 }}>
				<div className="min-w-0 flex-1" style={{ minWidth: 220 }}>
					<div className="flex items-baseline" style={{ gap: 10 }}>
						<h2 className="font-display m-0" style={{ fontWeight: 600, fontSize: 20 }}>
							Groups
						</h2>
						<SectionLabel as="span">{list.items.length}</SectionLabel>
					</div>
					<p className="m-0 text-muted" style={{ fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>
						{GROUPS_INTRO}
					</p>
				</div>
				{list.view === "admin" ? (
					<Button
						variant="outline"
						size={40}
						gap={8}
						style={{ padding: "0 16px 0 12px" }}
						onClick={() => setEditing({ kind: "new" })}
					>
						<IconPlus size={14} strokeWidth={2.4} />
						New group
					</Button>
				) : null}
			</div>

			<div className="overflow-hidden rounded-(--radius) border border-line bg-white" style={{ marginTop: 14 }}>
				{list.items.length === 0 ? (
					<p className="m-0 text-center text-muted" style={{ padding: "32px 20px", fontSize: 15 }}>
						{groupsEmpty(list.view === "admin")}
					</p>
				) : (
					<ul aria-label="Groups" className="m-0 list-none p-0">
						{list.view === "admin"
							? list.items.map((group) => (
									<GroupRow
										key={group.id}
										group={group}
										admin={{
											avatars: membersIn(team, group.memberIds).slice(0, MAX_GROUP_AVATARS),
											onEdit: () => setEditing({ kind: "edit", group }),
											onDelete: () => setDeleting(group),
										}}
									/>
								))
							: list.items.map((group) => <GroupRow key={group.id} group={group} admin={null} />)}
					</ul>
				)}
			</div>

			{editing ? (
				<GroupModal
					group={editing.kind === "edit" ? editing.group : undefined}
					members={team}
					youId={youId}
					onClose={() => setEditing(null)}
				/>
			) : null}
			{deleting ? <DeleteGroupDialog group={deleting} onClose={() => setDeleting(null)} /> : null}
		</>
	)
}
