import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { redactionInFlight } from "@/features/approvals/redactionStatus"
import { useLiveStatus } from "@/features/live/LiveEventsProvider"

/** How often the list re-reads while a Connection's Revision is still being redacted and the live feed is down. */
export const REDACTION_POLL_MS = 2_000

/**
 * `exagram.pending_revisions` decides what is in here; the browser never filters it.
 * A Connection's Revision cannot be approved until the worker has redacted it. The live feed's `redaction`
 * event refetches the list when the worker finishes; while the feed is down the list keeps re-reading
 * instead, otherwise Approve would stay disabled until a reload.
 */
export const usePendingRevisions = () => {
	const live = useLiveStatus() === "live"
	return useQuery({
		queryKey: QueryKeys.approvals.pending(),
		queryFn: () => apiClient.approvals.listPending(),
		refetchInterval: (query) => (!live && redactionInFlight(query.state.data ?? []) ? REDACTION_POLL_MS : false),
	})
}
