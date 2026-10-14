import { type MemberRole } from "@exagram/api-client"
import clsx from "clsx"

import { SheetSeparator } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { IconCheck } from "@/components/ui/icons"
import { SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { useMe } from "@/features/auth/hooks/useMe"
import { useMembers, useSetMemberRole } from "@/features/settings/team/hooks/useMembers"
import { lastActiveLine, memberMeta, ROLE_LABEL, type TeamMember } from "@/features/settings/team/teamModel"

const ROLES: readonly MemberRole[] = ["admin", "member"]

export default function MemberRoleSheet({ params }: { params: SheetParams["memberRole"] }) {
	const sheet = useSheet()
	const members = useMembers()
	const youId = useMe().data?.id
	const setRole = useSetMemberRole()

	if (members.isPending) return <SheetLoading title="Role" />
	const items: readonly TeamMember[] = members.data?.items ?? []
	const member = items.find((candidate) => candidate.id === params.userId)
	if (!member) {
		return (
			<Sheet title="Role">
				<SheetNote role={members.isError ? "alert" : undefined}>
					{members.isError ? members.error.message : "They are no longer in this Workspace."}
				</SheetNote>
			</Sheet>
		)
	}

	const you = member.id === youId
	const removable = !member.workspaceOwner && !you
	const pick = (role: MemberRole) => {
		if (setRole.isPending) return
		if (role === member.role) sheet.close()
		else if (you && role === "member") sheet.push("memberDemote", { userId: member.id })
		else setRole.mutate({ userId: member.id, name: member.name, role }, { onSuccess: sheet.close })
	}

	return (
		<Sheet title={you ? `${member.name} (you)` : member.name} sub={member.email}>
			<SheetNote>
				{[...("lastActiveAt" in member ? [lastActiveLine(member.lastActiveAt)] : []), memberMeta(member)].join(" · ")}
			</SheetNote>
			<div role="radiogroup" aria-label={`Role for ${member.name}`} style={{ padding: "0 6px 8px" }}>
				{ROLES.map((role) => {
					const on = role === member.role
					return (
						<button
							key={role}
							type="button"
							role="radio"
							aria-checked={on}
							disabled={setRole.isPending}
							onClick={() => pick(role)}
							className={clsx(
								"flex w-full items-center text-left disabled:opacity-60",
								on ? "bg-row-selected" : "active:bg-hover",
							)}
							style={{ gap: 12, minHeight: 48, padding: "6px 10px" }}
						>
							<span className="flex-1" style={{ fontSize: 15, fontWeight: 500 }}>
								{ROLE_LABEL[role]}
							</span>
							{on ? <IconCheck size={17} className="flex-none text-ink" /> : null}
						</button>
					)
				})}
				{removable ? (
					<>
						<SheetSeparator />
						<button
							type="button"
							disabled={setRole.isPending}
							onClick={() => sheet.push("memberRemove", { userId: member.id })}
							className="w-full text-left text-danger active:bg-danger-bg disabled:opacity-60"
							style={{ minHeight: 48, padding: "0 10px", fontSize: 15 }}
						>
							Remove from Workspace
						</button>
					</>
				) : null}
			</div>
		</Sheet>
	)
}
