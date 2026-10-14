import { useSheet } from "@/components/mobile/sheet/context"
import { IconPlus } from "@/components/ui/icons"
import { edition } from "@/edition/edition"
import { useMe } from "@/features/auth/hooks/useMe"
import { useInvites } from "@/features/settings/hooks/useInvites"
import { Label } from "@/features/settings/mobileParts"
import { GroupsSection } from "@/features/settings/team/GroupsSection.mobile"
import { useMembers } from "@/features/settings/team/hooks/useMembers"
import { InviteLink } from "@/features/settings/team/InviteLink.mobile"
import { MembersSection } from "@/features/settings/team/MembersSection.mobile"
import { teamSummary } from "@/features/settings/team/teamModel"

export default function TeamPageMobile() {
	const sheet = useSheet()
	const youId = useMe().data?.id
	const members = useMembers()
	const joining = edition.useTeamJoining()
	const admin = members.data?.view === "admin"
	const requests = edition.useTeamRequestsMobile(admin)
	const invites = useInvites(admin)
	const emailed = joining.emailed
	const canInvite = joining.ready && (admin || joining.memberInvites)

	return (
		<>
			<Label first>{members.data ? teamSummary(members.data.items, requests.seatsLine) : "Members"}</Label>
			{canInvite ? (
				<button
					type="button"
					onClick={() => sheet.open("teamInvite", {})}
					className="flex w-full items-center justify-center bg-ink text-white active:bg-primary-hover"
					style={{ gap: 8, height: 46, borderRadius: 6, fontSize: 15, fontWeight: 500 }}
				>
					<IconPlus size={15} strokeWidth={2.4} />
					Invite member
				</button>
			) : null}

			{[joining.error, ...requests.errors, ...(admin ? [invites.list.error] : [])].map((error) =>
				error ? (
					<p key={error.message} role="alert" className="m-0 text-danger" style={{ fontSize: 14, marginTop: 12 }}>
						{error.message}
					</p>
				) : null,
			)}
			{invites.errorMessage ? (
				<p role="alert" className="m-0 text-danger" style={{ fontSize: 14, marginTop: 12 }}>
					{invites.errorMessage}
				</p>
			) : null}
			{invites.issued ? (
				<div style={{ marginTop: 12 }}>
					<InviteLink issued={invites.issued} onCopy={invites.copy} />
				</div>
			) : null}

			{requests.section}
			<MembersSection
				list={members}
				youId={youId}
				invites={invites}
				pendingInvites={invites.list.data ?? []}
				emailed={emailed}
			/>
			<GroupsSection />
			{admin ? joining.section : null}
		</>
	)
}
