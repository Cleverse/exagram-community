import { type WorkspaceInvite } from "@exagram/api-client"

import { Button } from "@/components/ui/Button"
import { IconMail } from "@/components/ui/icons"
import { SectionLabel } from "@/components/ui/Mono"
import { type useInvites } from "@/features/settings/hooks/useInvites"
import { pendingInviteMeta } from "@/features/settings/team/teamModel"

export const PendingInvites = ({
	rows,
	invites,
	emailed,
}: {
	rows: readonly WorkspaceInvite[]
	invites: ReturnType<typeof useInvites>
	emailed: boolean
}) => (
	<section aria-labelledby="pending-invites" style={{ marginTop: 32 }}>
		<div className="flex items-baseline" style={{ gap: 10 }}>
			<h2 id="pending-invites" className="font-display m-0" style={{ fontWeight: 600, fontSize: 20 }}>
				Pending invites
			</h2>
			<SectionLabel as="span">{`${rows.length} pending`}</SectionLabel>
		</div>
		<ul
			className="m-0 list-none overflow-hidden rounded-(--radius) border border-line bg-white p-0"
			style={{ marginTop: 12 }}
		>
			{rows.map((invite) => (
				<li
					key={invite.id}
					className="flex items-center border-b border-row-line last:border-b-0"
					style={{ gap: 14, padding: "12px 20px" }}
				>
					<div
						aria-hidden
						className="grid flex-none place-items-center text-muted-2"
						style={{ width: 36, height: 36, borderRadius: "var(--radius)", border: "1.5px dashed #b7bac7" }}
					>
						<IconMail size={15} />
					</div>
					<div className="min-w-0 flex-1">
						<div className="truncate" style={{ fontSize: 15, fontWeight: 500 }}>
							{invite.email}
						</div>
						<div className="text-muted" style={{ fontSize: 14 }}>
							{pendingInviteMeta(invite)}
						</div>
					</div>
					<Button
						variant="outline"
						style={{ height: 34 }}
						disabled={invites.renew.isPending}
						onClick={() => invites.renew.mutate(invite.id)}
						aria-label={`${emailed ? "Resend invite to" : "Copy new link for"} ${invite.email}`}
					>
						{emailed ? "Resend" : "Copy new link"}
					</Button>
					<Button
						variant="dangerGhost"
						style={{ height: 34 }}
						disabled={invites.revoke.isPending}
						onClick={() => invites.revoke.mutate(invite.id)}
						aria-label={`Revoke invite for ${invite.email}`}
					>
						Revoke
					</Button>
				</li>
			))}
		</ul>
	</section>
)
