import { type GrantRole, type Notification } from "@exagram/api-client"
import { useMutation, useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { recordSent, type SentRequest, useForgetSent, useSentRequest } from "@/features/access-requests/sentRequests"
import { MAX_PAGES } from "@/features/notifications/notificationPlan"
import { useStateScope } from "@/features/workspace/stateScope"
import { useNow } from "@/utils/useNow"

const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000

const CLOCK_SKEW_MS = 5 * 60 * 1000

type Granted = { title: string; ownerName: string | null; role: GrantRole }

/** A decline names neither the file nor its Owner, so `declined` carries nothing. */
type RequestAnswer = ({ outcome: "granted" } & Granted) | { outcome: "declined" }

const answerOf = (item: Notification, artifactId: string): RequestAnswer | null => {
	if (item.kind !== "decision" || item.subject !== "accessRequest" || item.artifactId !== artifactId) return null
	if (item.outcome === "declined") return { outcome: "declined" }
	if (item.outcome === "granted" && item.role !== null)
		return { outcome: "granted", title: item.title, ownerName: item.actorName, role: item.role }
	return null
}

const lookUpAnswer = async (artifactId: string, since: number): Promise<RequestAnswer | null> => {
	let answer: RequestAnswer | null = null
	let page = await apiClient.notifications.list({ since: new Date(since - CLOCK_SKEW_MS) })
	for (let read = 1; ; read += 1) {
		for (const item of page.items) answer = answerOf(item, artifactId) ?? answer
		if (page.next === null) return answer
		if (read >= MAX_PAGES) {
			if (answer !== null) return answer
			throw new Error("The feed is too long to search for an answer")
		}
		page = await apiClient.notifications.list({ after: page.next })
	}
}

export const useRequestAnswer = (artifactId: string, sent: SentRequest | undefined) => {
	const query = useQuery({
		queryKey: QueryKeys.notifications.requestAnswer(artifactId, sent?.at ?? 0),
		queryFn: () => lookUpAnswer(artifactId, sent?.at ?? 0),
		enabled: sent !== undefined,
		staleTime: 5_000,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
	})
	const failed = query.isError
	// An answer cached before this screen opened may predate the Owner's reply, so only one fetched since counts.
	const asking = sent !== undefined && !failed && !query.isFetchedAfterMount
	return { asking, failed, answer: asking || failed ? null : (query.data ?? null) }
}

const post = (artifactId: string, { role, note }: Pick<SentRequest, "role" | "note">) =>
	apiClient.accessRequests.create({ artifactId, role, ...(note ? { note } : {}) })

/**
 * Where this browser's Access Request on a file stands. The server never says whether a request is open,
 * so `sent` is this browser's memory of sending one, and `answer` comes from the member's own feed. Another browser
 * starts without either.
 */
export const useMyAccessRequest = (artifactId: string) => {
	const scope = useStateScope()
	const sent = useSentRequest(artifactId)
	const { answer } = useRequestAnswer(artifactId, sent)
	const now = useNow().getTime()
	const forget = useForgetSent(artifactId)

	const send = useMutation({
		mutationFn: (input: Pick<SentRequest, "role" | "note">) => post(artifactId, input),
		onSuccess: (_, input) => recordSent(scope, artifactId, { ...input, at: Date.now() }),
	})
	const remind = useMutation({
		mutationFn: (request: SentRequest) => post(artifactId, request),
		onSuccess: (_, request) => recordSent(scope, artifactId, { ...request, at: Date.now() }),
	})
	const cancel = useMutation({
		mutationFn: () => apiClient.accessRequests.cancel({ artifactId }),
		onSuccess: forget,
	})

	return {
		sent,
		answer,
		canRemind: sent !== undefined && now - sent.at >= REMINDER_AFTER_MS,
		send,
		remind,
		cancel,
	}
}
