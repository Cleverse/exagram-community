import { type WorkspaceInvite } from "@exagram/api-client"
import { useState } from "react"

import { useSheet } from "@/components/mobile/sheet/context"
import { Avatar } from "@/components/ui/Avatar"
import { IconChevronRight, IconSearch } from "@/components/ui/icons"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { type useInvites } from "@/features/settings/hooks/useInvites"
import { Card, SectionHead } from "@/features/settings/mobileParts"
import { type useMembers } from "@/features/settings/team/hooks/useMembers"
import { NO_MEMBERS_MATCH } from "@/features/settings/team/teamCopy"
import {
	matchesQuery,
	pendingInviteMeta,
	ROLE_LABEL,
	sortTeam,
	type TeamMember,
} from "@/features/settings/team/teamModel"
import { initialsOf } from "@/utils/initials"

const MemberRow = ({ member, you, admin }: { member: TeamMember; you: boolean; admin: boolean }) => {
	const sheet = useSheet()
	const name = you ? `${member.name} (you)` : member.name
	const role = member.workspaceOwner ? "Owner" : ROLE_LABEL[member.role]
	const content = (
		<>
			<Avatar
				initials={initialsOf(member.name, member.email)}
				size={36}
				background={member.workspaceOwner ? "var(--color-ink)" : "var(--color-nav-selected)"}
				color={member.workspaceOwner ? "white" : "var(--color-ink)"}
				className="flex-none"
			/>
			<span className="min-w-0 flex-1">
				<span className="block truncate" style={{ fontSize: 15, fontWeight: 500 }}>
					{name}
				</span>
				<span className="block truncate text-muted" style={{ fontSize: 13 }}>
					{member.email}
				</span>
			</span>
			<span className="flex-none text-muted" style={{ fontSize: 14 }}>
				{role}
			</span>
		</>
	)
	const rowStyle = { gap: 12, minHeight: 60, padding: "10px 14px" }

	return (
		<li className="border-b border-row-line last:border-b-0">
			{admin && !member.workspaceOwner ? (
				<button
					type="button"
					aria-label={`${role}, change role for ${member.name}`}
					onClick={() => sheet.open("memberRole", { userId: member.id })}
					className="flex w-full items-center text-left active:bg-hover"
					style={rowStyle}
				>
					{content}
					<IconChevronRight size={15} className="flex-none text-path-slash" />
				</button>
			) : (
				<div className="flex items-center" style={rowStyle}>
					{content}
				</div>
			)}
		</li>
	)
}

const PendingInvites = ({
	rows,
	invites,
	emailed,
}: {
	rows: readonly WorkspaceInvite[]
	invites: ReturnType<typeof useInvites>
	emailed: boolean
}) => (
	<section aria-label="Pending invites">
		<SectionHead count={rows.length}>Pending invites</SectionHead>
		<Card>
			<ul className="m-0 list-none p-0">
				{rows.map((invite) => (
					<li key={invite.id} className="border-b border-row-line last:border-b-0" style={{ padding: "10px 14px" }}>
						<div className="truncate" style={{ fontSize: 15, fontWeight: 500 }}>
							{invite.email}
						</div>
						<div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
							{pendingInviteMeta(invite)}
						</div>
						<div className="flex" style={{ gap: 8, marginTop: 8 }}>
							<button
								type="button"
								disabled={invites.renew.isPending}
								onClick={() => invites.renew.mutate(invite.id)}
								aria-label={`${emailed ? "Resend invite to" : "Copy new link for"} ${invite.email}`}
								className="border border-line-strong text-ink active:bg-hover disabled:opacity-60"
								style={{ height: 44, padding: "0 14px", fontSize: 14, fontWeight: 500 }}
							>
								{emailed ? "Resend" : "Copy new link"}
							</button>
							<button
								type="button"
								disabled={invites.revoke.isPending}
								onClick={() => invites.revoke.mutate(invite.id)}
								aria-label={`Revoke invite for ${invite.email}`}
								className="text-danger active:bg-danger-bg disabled:opacity-60"
								style={{ height: 44, padding: "0 14px", fontSize: 14, fontWeight: 500 }}
							>
								Revoke
							</button>
						</div>
					</li>
				))}
			</ul>
		</Card>
	</section>
)

export const MembersSection = ({
	list,
	youId,
	invites,
	pendingInvites,
	emailed,
}: {
	list: ReturnType<typeof useMembers>
	youId: string | undefined
	invites: ReturnType<typeof useInvites>
	pendingInvites: readonly WorkspaceInvite[]
	emailed: boolean
}) => {
	const [query, setQuery] = useState("")
	const members = list.data
	const admin = members?.view === "admin"
	const shown = members ? sortTeam(members.items, youId).filter((member) => matchesQuery(member, query)) : []

	return (
		<>
			<section aria-label="Members">
				<SectionHead count={members?.items.length}>Members</SectionHead>
				{list.isPending ? (
					<SkeletonStatus label="Loading members…">
						<Skeleton height={180} radius={10} />
					</SkeletonStatus>
				) : list.error ? (
					<p role="alert" className="m-0 text-danger" style={{ fontSize: 14 }}>
						{list.error.message}
					</p>
				) : (
					<>
						<label className="relative block" style={{ marginBottom: 10 }}>
							<IconSearch
								size={16}
								className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-2"
								style={{ left: 13 }}
							/>
							<span className="sr-only">Search members</span>
							<input
								type="search"
								placeholder="Search members"
								className="block w-full border border-line-soft bg-white outline-0 focus:border-ink"
								style={{ height: 44, padding: "0 12px 0 38px", fontSize: 16 }}
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
						</label>
						{shown.length === 0 ? (
							<p className="m-0 text-center text-muted" style={{ padding: "24px 0", fontSize: 14 }}>
								{NO_MEMBERS_MATCH}
							</p>
						) : (
							<Card>
								<ul aria-label="Members" className="m-0 list-none p-0">
									{shown.map((member) => (
										<MemberRow key={member.id} member={member} you={member.id === youId} admin={admin} />
									))}
								</ul>
							</Card>
						)}
					</>
				)}
			</section>
			{admin && pendingInvites.length > 0 ? (
				<PendingInvites rows={pendingInvites} invites={invites} emailed={emailed} />
			) : null}
		</>
	)
}
