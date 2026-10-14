import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { withinWindow } from "../auditModel"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const PAGE = 100

/**
 * Every ledger entry inside the audit window. One `ledger.activity` page caps at 100, so this
 * follows `nextCursor` until the oldest entry falls outside the window or the ledger runs out.
 *
 * `enabled` is `me.isAdmin`: a non-admin's browser never calls the endpoint that only refuses it.
 * There is no `refetchInterval` — a 90-day window can be many pages, and polling would re-fetch
 * every one of them on a timer; the Audit header instead offers a manual Refresh.
 */
export const useAuditWindow = (enabled: boolean) => {
	const query = useInfiniteQuery({
		queryKey: QueryKeys.ledger.activityWindow(PAGE),
		queryFn: ({ pageParam }) => apiClient.ledger.activity({ limit: PAGE, cursor: pageParam }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (last) => {
			const oldest = last.items.at(-1)
			if (last.nextCursor === null || oldest === undefined || !withinWindow(oldest.startedAt)) return undefined
			return last.nextCursor
		},
		enabled,
		refetchInterval: false,
	})

	const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
	useEffect(() => {
		if (enabled && hasNextPage && !isFetchingNextPage) void fetchNextPage()
	}, [enabled, hasNextPage, isFetchingNextPage, fetchNextPage])

	return { ...query, items: query.data?.pages.flatMap((page) => page.items) ?? [] }
}
