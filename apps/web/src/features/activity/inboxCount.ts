import { type PendingRevision } from "@exagram/api-client"
import { useMemo } from "react"

import { useAccessRequests } from "@/features/access-requests/hooks/useAccessRequests"
import { buildFeed } from "@/features/activity/activityFeed"
import { isUnread, useLastSeen } from "@/features/activity/lastSeen"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { useMe } from "@/features/auth/hooks/useMe"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useNow } from "@/utils/useNow"

/**
 * The Revisions waiting on this person: only those the server says they approve. The queue also holds the
 * reader's own drafts as Author, and inside a folder the Approver is the folder's owner, not the file's.
 */
export const approvalsFor = (pending: PendingRevision[]) => pending.filter((revision) => revision.isApprover).length

/**
 * The bell's badge on mobile: pending approvals, open Access Requests on files this person owns,
 * and unread updates, the others' publishes in the last day since this person last left Activity.
 */
export const useInboxCount = () => {
	const me = useMe()
	const pending = usePendingRevisions()
	const requests = useAccessRequests()
	const artifacts = useArtifacts({ scope: "all" })
	const lastSeen = useLastSeen()
	const now = useNow()
	const meId = me.data?.id ?? null

	const unread = useMemo(
		() =>
			buildFeed({ artifacts: artifacts.data ?? [], pending: [], meId, meInitials: "" }).filter((event) =>
				isUnread(event, lastSeen, now),
			).length,
		[artifacts.data, meId, lastSeen, now],
	)
	return approvalsFor(pending.data ?? []) + (requests.data?.length ?? 0) + unread
}
