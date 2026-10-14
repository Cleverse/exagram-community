import { IconCopy } from "@/components/ui/icons"
import { type useInvites } from "@/features/settings/hooks/useInvites"
import { issuedInviteNote } from "@/features/settings/team/teamCopy"

export const InviteLink = ({
	issued,
	onCopy,
}: {
	issued: NonNullable<ReturnType<typeof useInvites>["issued"]>
	onCopy: (url: string) => void
}) => (
	<div className="border border-card-line" style={{ borderRadius: 10, padding: "12px 6px 12px 14px" }}>
		<p className="m-0 text-muted" style={{ fontSize: 14, lineHeight: 1.5, paddingRight: 8 }}>
			{issuedInviteNote(issued.invite.email)}
		</p>
		<div className="flex items-center" style={{ gap: 4, marginTop: 6 }}>
			<span className="font-mono min-w-0 flex-1 break-all text-secondary" style={{ fontSize: 13 }}>
				{issued.url}
			</span>
			<button
				type="button"
				aria-label="Copy invite link"
				onClick={() => onCopy(issued.url)}
				className="grid flex-none place-items-center text-secondary active:bg-hover"
				style={{ width: 44, height: 44 }}
			>
				<IconCopy size={16} />
			</button>
		</div>
	</div>
)
