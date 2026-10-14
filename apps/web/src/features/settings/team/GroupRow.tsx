import { type Group } from "@exagram/api-client"

import { Avatar } from "@/components/ui/Avatar"
import { Button } from "@/components/ui/Button"
import { IconPeople, IconTrash } from "@/components/ui/icons"
import { memberCountLabel, type TeamMember } from "@/features/settings/team/teamModel"
import { initialsOf } from "@/utils/initials"

export type GroupAdminView = { avatars: readonly TeamMember[]; onEdit: () => void; onDelete: () => void }

export const GroupRow = ({ group, admin }: { group: Group; admin: GroupAdminView | null }) => {
	const shown = admin?.avatars ?? []
	const folded = group.memberCount - shown.length

	return (
		<li
			className="flex items-center border-b border-row-line last:border-b-0 hover:bg-[#fbfbfd]"
			style={{ gap: 14, padding: "12px 16px" }}
		>
			<div
				className="grid flex-none place-items-center bg-subtle text-ink"
				style={{ width: 36, height: 36, borderRadius: "var(--radius)" }}
			>
				<IconPeople size={18} strokeWidth={1.8} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate" style={{ fontSize: 15, fontWeight: 500 }}>
					{group.name}
				</div>
				<div className="truncate text-muted" style={{ fontSize: 14 }}>
					{memberCountLabel(group.memberCount)}
				</div>
			</div>
			{admin === null ? null : (
				<>
					{shown.length > 0 ? (
						<div className="flex flex-none items-center" style={{ paddingLeft: 6 }}>
							{shown.map((member) => (
								<Avatar
									key={member.id}
									initials={initialsOf(member.name, member.email)}
									title={member.name}
									size={28}
									fontSize={10}
									background="var(--color-subtle)"
									color="var(--color-ink)"
									style={{ border: "2px solid white", marginLeft: -6 }}
								/>
							))}
							{folded > 0 ? (
								<div
									className="grid place-items-center font-mono"
									style={{
										width: 28,
										height: 28,
										borderRadius: "var(--radius)",
										background: "var(--color-ground)",
										border: "2px solid white",
										marginLeft: -6,
										fontSize: 10,
										color: "var(--color-secondary)",
									}}
								>
									{`+${folded}`}
								</div>
							) : null}
						</div>
					) : null}
					<Button
						variant="outline"
						size={32}
						className="flex-none"
						aria-label={`Edit ${group.name}`}
						onClick={admin.onEdit}
					>
						Edit
					</Button>
					<button
						type="button"
						title="Delete group"
						aria-label={`Delete ${group.name}`}
						onClick={admin.onDelete}
						className="grid flex-none place-items-center text-muted-2 hover:bg-hover hover:text-danger"
						style={{ width: 32, height: 32, borderRadius: "var(--radius)" }}
					>
						<IconTrash size={16} />
					</button>
				</>
			)}
		</li>
	)
}
