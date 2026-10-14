import clsx from "clsx"
import { Link, useLocation } from "react-router"

import { IconInbox } from "@/components/ui/icons"
import { useAccessRequests } from "@/features/access-requests/hooks/useAccessRequests"
import { approvalsFor } from "@/features/activity/inboxCount"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { paths } from "@/routes/paths"

/**
 * The sidebar's Inbox, beside the collapse toggle: opens the Activity screen, with an amber dot while something
 * awaits this person — the Revisions they approve (the Owner approves) and the open Access Requests on
 * files they own. The count is in the accessible name.
 */
export const InboxButton = ({ size = 32 }: { size?: 28 | 32 | 36 }) => {
	const location = useLocation()
	const pending = usePendingRevisions()
	const requests = useAccessRequests()
	const count = approvalsFor(pending.data ?? []) + (requests.data?.length ?? 0)
	const active = location.pathname === paths.activity
	return (
		<Link
			to={paths.activity}
			title="Inbox"
			aria-label={count > 0 ? `Inbox, ${count} awaiting your action` : "Inbox"}
			aria-current={active ? "page" : undefined}
			className={clsx(
				"press relative grid flex-none place-items-center rounded-(--radius) text-secondary hover:bg-hover",
				active && "bg-hover text-ink",
			)}
			style={{ width: size, height: size }}
		>
			<IconInbox size={18} />
			{count > 0 ? (
				<span
					aria-hidden
					className="absolute rounded-full bg-pending"
					style={{ top: 3, right: 3, width: 8, height: 8, boxShadow: "0 0 0 2px var(--color-sidebar)" }}
				/>
			) : null}
		</Link>
	)
}
