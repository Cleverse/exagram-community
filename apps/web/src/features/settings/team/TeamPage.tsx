import { useRef, useState } from "react"
import { useSearchParams } from "react-router"

import { Button } from "@/components/ui/Button"
import { IconButton } from "@/components/ui/IconButton"
import { IconCopy, IconPlus } from "@/components/ui/icons"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { UnderlineTabs } from "@/components/ui/UnderlineTabs"
import { edition } from "@/edition/edition"
import { useMe } from "@/features/auth/hooks/useMe"
import { useInvites } from "@/features/settings/hooks/useInvites"
import { GroupsTab } from "@/features/settings/team/GroupsTab"
import { useGroups } from "@/features/settings/team/hooks/useGroups"
import { useMembers } from "@/features/settings/team/hooks/useMembers"
import { InvitePanel } from "@/features/settings/team/InvitePanel"
import { MembersTab } from "@/features/settings/team/MembersTab"
import { issuedInviteNote } from "@/features/settings/team/teamCopy"
import { teamSummary } from "@/features/settings/team/teamModel"

type TeamTab = "members" | "groups" | "joining"

const TAB_PARAM = "tab"

export const TeamPage = () => {
	const me = useMe()
	const members = useMembers()
	const joining = edition.useTeamJoining()
	const groups = useGroups()
	const admin = members.data?.view === "admin"
	const requests = edition.useTeamRequests(admin)
	const invites = useInvites(admin)
	const [params, setParams] = useSearchParams()
	const requested = params.get(TAB_PARAM)
	const joiningTab = admin ? joining.tab : null
	const tab: TeamTab =
		requested === "groups" ? "groups" : joiningTab !== null && requested === "joining" ? "joining" : "members"
	const selectTab = (next: TeamTab) => setParams(next === "members" ? {} : { [TAB_PARAM]: next })
	const [inviting, setInviting] = useState(false)
	const inviteButton = useRef<HTMLButtonElement>(null)
	const closeInvite = () => {
		setInviting(false)
		inviteButton.current?.focus()
	}
	const emailed = joining.emailed
	const canInvite = joining.ready && (admin || joining.memberInvites)

	return (
		<div data-screen-label="Team" style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px 96px" }}>
			<div className="flex flex-wrap items-end" style={{ gap: 16 }}>
				<div className="flex-1" style={{ minWidth: 220 }}>
					<h1 className="font-display m-0" style={{ fontWeight: 600, fontSize: 28 }}>
						Team
					</h1>
					<p className="m-0 text-muted" style={{ fontSize: 16, marginTop: 6, minHeight: 24 }}>
						{members.data ? teamSummary(members.data.items, requests.seatsLine) : null}
					</p>
				</div>
				{canInvite ? (
					<Button
						ref={inviteButton}
						size={44}
						gap={10}
						aria-expanded={inviting}
						style={{ padding: "0 20px 0 16px", fontSize: 15 }}
						onClick={() => setInviting((open) => !open)}
					>
						<IconPlus size={16} strokeWidth={2.4} />
						Invite member
					</Button>
				) : null}
			</div>

			{inviting && canInvite ? (
				<InvitePanel
					invites={invites}
					domain={joining.domain}
					emailed={emailed}
					canChooseRole={admin && edition.adminInvites}
					onClose={closeInvite}
				/>
			) : null}
			{invites.errorMessage ? (
				<p role="alert" className="m-0 text-danger" style={{ fontSize: 14, marginTop: 10 }}>
					{invites.errorMessage}
				</p>
			) : null}
			{invites.issued ? (
				<div className="rounded-(--radius) border border-line bg-white" style={{ marginTop: 12, padding: "12px 16px" }}>
					<div className="text-muted" style={{ fontSize: 14 }}>
						{issuedInviteNote(invites.issued.invite.email)}
					</div>
					<div className="flex items-center" style={{ gap: 8, marginTop: 4 }}>
						<span className="font-mono min-w-0 flex-1 truncate text-secondary" style={{ fontSize: 13 }}>
							{invites.issued.url}
						</span>
						<IconButton
							size={32}
							title="Copy invite link"
							aria-label="Copy invite link"
							onClick={() => invites.issued && invites.copy(invites.issued.url)}
						>
							<IconCopy size={15} />
						</IconButton>
					</div>
				</div>
			) : null}

			<UnderlineTabs
				ariaLabel="Team"
				size="lg"
				style={{ marginTop: 24 }}
				value={tab}
				onChange={selectTab}
				tabs={[
					{
						value: "members",
						label: "Members",
						...(requests.count > 0
							? {
									badge: {
										value: requests.count,
										label: `${requests.count} ${requests.count === 1 ? "join request" : "join requests"}`,
									},
								}
							: { count: members.data?.items.length }),
					},
					{ value: "groups", label: "Groups", count: groups.data?.items.length },
					...(joiningTab !== null ? [{ value: "joining" as const, label: "Joining & sharing" }] : []),
				]}
			/>

			{[joining.error, ...requests.errors, ...(admin ? [invites.list.error] : [])].map((error) =>
				error ? (
					<p key={error.message} role="alert" className="m-0 text-danger" style={{ fontSize: 14, marginTop: 16 }}>
						{error.message}
					</p>
				) : null,
			)}

			{tab === "groups" ? (
				<GroupsTab />
			) : tab === "joining" ? (
				joiningTab
			) : members.isPending ? (
				<SkeletonStatus label="Loading members…">
					<Skeleton height={320} style={{ marginTop: 28 }} />
				</SkeletonStatus>
			) : members.isError ? (
				<p role="alert" className="m-0 text-danger" style={{ fontSize: 14, marginTop: 28 }}>
					{members.error.message}
				</p>
			) : (
				<MembersTab
					list={members.data}
					youId={me.data?.id}
					requestsSection={requests.section}
					invites={invites}
					pending={invites.list.data ?? []}
					emailed={emailed}
				/>
			)}
		</div>
	)
}
