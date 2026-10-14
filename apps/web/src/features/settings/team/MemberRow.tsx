import { type MemberRole } from "@exagram/api-client"

import { Avatar } from "@/components/ui/Avatar"
import { IconTrash } from "@/components/ui/icons"
import { SectionLabel } from "@/components/ui/Mono"
import { edition } from "@/edition/edition"
import { lastActiveLabel, memberMeta, ROLE_LABEL, type TeamMember } from "@/features/settings/team/teamModel"
import { initialsOf } from "@/utils/initials"

export const ADMIN_COLUMNS = "minmax(0,1fr) 116px 90px 32px"
export const MEMBER_COLUMNS = "minmax(0,1fr) 116px"

export const MemberRow = ({
	member,
	you,
	admin,
	onRole,
	onRemove,
}: {
	member: TeamMember
	you: boolean
	admin: boolean
	onRole: (role: MemberRole) => void
	onRemove: () => void
}) => (
	<li
		className="grid items-center border-b border-row-line last:border-b-0 hover:bg-[#fbfbfd]"
		style={{ gridTemplateColumns: admin ? ADMIN_COLUMNS : MEMBER_COLUMNS, gap: 12, padding: "12px 16px" }}
	>
		<div className="flex min-w-0 items-center" style={{ gap: 12 }}>
			<Avatar
				initials={initialsOf(member.name, member.email)}
				size={36}
				background={member.workspaceOwner ? "var(--color-ink)" : "var(--color-nav-selected)"}
				color={member.workspaceOwner ? "white" : "var(--color-ink)"}
				className="flex-none"
			/>
			<div className="min-w-0">
				<div className="text-pretty" style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.3 }}>
					{you ? `${member.name} (you)` : member.name}
				</div>
				<div className="truncate text-muted" style={{ fontSize: 14 }}>
					{member.email}
				</div>
				<div className="truncate text-muted-2" style={{ fontSize: 12, marginTop: 2 }}>
					{memberMeta(member)}
				</div>
			</div>
		</div>
		<div>
			{member.workspaceOwner ? (
				<SectionLabel
					as="span"
					className="text-ink"
					style={{ padding: "5px 9px", borderRadius: "var(--radius)", background: "var(--color-row-selected)" }}
				>
					Owner
				</SectionLabel>
			) : admin ? (
				<select
					aria-label={`Role for ${member.name}`}
					className="w-full rounded-(--radius) border border-line-strong bg-white outline-0 focus:border-ink"
					style={{ height: 34, padding: "0 8px", fontSize: 14 }}
					value={member.role}
					onChange={(event) => onRole(event.target.value as MemberRole)}
				>
					<option value="admin">Admin</option>
					<option value="member">Member</option>
				</select>
			) : (
				<span className="text-muted" style={{ fontSize: 14 }}>
					{ROLE_LABEL[member.role]}
				</span>
			)}
		</div>
		{"lastActiveAt" in member ? (
			<div className="whitespace-nowrap text-muted" style={{ fontSize: 14 }}>
				{lastActiveLabel(member.lastActiveAt)}
			</div>
		) : null}
		{admin ? (
			<div className="flex justify-end">
				{member.workspaceOwner || you ? null : (
					<button
						type="button"
						title={edition.copy.removeMemberTitle}
						aria-label={edition.copy.removeMemberLabel(member.name)}
						onClick={onRemove}
						className="grid place-items-center text-muted-2 hover:bg-hover hover:text-danger"
						style={{ width: 32, height: 32, borderRadius: "var(--radius)" }}
					>
						<IconTrash size={16} />
					</button>
				)}
			</div>
		) : null}
	</li>
)
