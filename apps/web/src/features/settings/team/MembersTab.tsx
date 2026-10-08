import { type MemberList, type MemberRole, type WorkspaceInvite } from "@exagram/api-client"
import { type ReactNode, useState } from "react"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { IconSearch } from "@/components/ui/icons"
import { SectionLabel } from "@/components/ui/Mono"
import { edition } from "@/edition/edition"
import { type useInvites } from "@/features/settings/hooks/useInvites"
import { useSetMemberRole } from "@/features/settings/team/hooks/useMembers"
import { ADMIN_COLUMNS, MEMBER_COLUMNS, MemberRow } from "@/features/settings/team/MemberRow"
import { PendingInvites } from "@/features/settings/team/PendingInvites"
import { RemoveMemberDialog } from "@/features/settings/team/RemoveMemberDialog"
import { matchesQuery, sortTeam, type TeamMember } from "@/features/settings/team/teamModel"

export const MembersTab = ({
	list,
	youId,
	requestsSection,
	invites,
	pending,
	emailed,
}: {
	list: MemberList
	youId: string | undefined
	requestsSection: ReactNode
	invites: ReturnType<typeof useInvites>
	pending: readonly WorkspaceInvite[]
	emailed: boolean
}) => {
	const [query, setQuery] = useState("")
	const [removing, setRemoving] = useState<TeamMember | null>(null)
	const [demotingYourself, setDemotingYourself] = useState<TeamMember | null>(null)
	const setRole = useSetMemberRole()
	const admin = list.view === "admin"
	const members = sortTeam(list.items, youId)
	const shown = members.filter((member) => matchesQuery(member, query))
	const changeRole = (member: TeamMember, role: MemberRole) => {
		if (member.id === youId && role === "member") setDemotingYourself(member)
		else setRole.mutate({ userId: member.id, name: member.name, role })
	}

	return (
		<>
			{requestsSection}

			<div className="flex items-center" style={{ gap: 12, marginTop: 28 }}>
				<h2 className="font-display m-0 flex-none" style={{ fontWeight: 600, fontSize: 20, marginRight: 8 }}>
					Members
				</h2>
				<label
					className="flex flex-1 items-center rounded-(--radius) border border-line-strong bg-white focus-within:border-ink"
					style={{ gap: 10, height: 40, padding: "0 14px", maxWidth: 360 }}
				>
					<IconSearch size={16} className="flex-none text-muted-2" />
					<span className="sr-only">Search members</span>
					<input
						type="search"
						placeholder="Search members"
						className="min-w-0 flex-1 border-0 bg-transparent outline-0"
						style={{ fontSize: 15 }}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
			</div>

			<div className="overflow-hidden rounded-(--radius) border border-line bg-white" style={{ marginTop: 14 }}>
				<div
					className="grid border-b border-line bg-[#fbfbfd]"
					style={{ gridTemplateColumns: admin ? ADMIN_COLUMNS : MEMBER_COLUMNS, gap: 12, padding: "12px 16px" }}
				>
					<SectionLabel>Member</SectionLabel>
					<SectionLabel>Role</SectionLabel>
					{admin ? (
						<>
							<SectionLabel>Last active</SectionLabel>
							<div />
						</>
					) : null}
				</div>
				{shown.length === 0 ? (
					<p className="m-0 text-center text-muted" style={{ padding: "40px 20px", fontSize: 15 }}>
						No members match.
					</p>
				) : (
					<ul aria-label="Members" className="m-0 list-none p-0">
						{shown.map((member) => (
							<MemberRow
								key={member.id}
								member={member}
								you={member.id === youId}
								admin={admin}
								onRole={(role) => changeRole(member, role)}
								onRemove={() => setRemoving(member)}
							/>
						))}
					</ul>
				)}
			</div>

			{admin && pending.length > 0 ? <PendingInvites rows={pending} invites={invites} emailed={emailed} /> : null}

			{removing ? (
				<RemoveMemberDialog target={removing} members={members} youId={youId} onClose={() => setRemoving(null)} />
			) : null}

			{demotingYourself ? (
				<Dialog
					title="Change your role to Member?"
					onClose={() => setDemotingYourself(null)}
					width={480}
					footer={
						<>
							<Button variant="outline" size={40} onClick={() => setDemotingYourself(null)}>
								Cancel
							</Button>
							<Button
								variant="danger"
								size={40}
								onClick={() => {
									setRole.mutate({ userId: demotingYourself.id, name: demotingYourself.name, role: "member" })
									setDemotingYourself(null)
								}}
							>
								Change to Member
							</Button>
						</>
					}
				>
					<p className="m-0 text-secondary" style={{ fontSize: 15, lineHeight: 1.55 }}>
						{edition.copy.demoteYourself}
					</p>
				</Dialog>
			) : null}
		</>
	)
}
