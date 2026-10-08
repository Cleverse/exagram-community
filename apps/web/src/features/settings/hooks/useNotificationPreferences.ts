import { type NotificationPreferences } from "@exagram/api-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"

/**
 * The four switches, in the order Settings shows them, each with its label and what it covers. A Personal Workspace
 * drops the `teamOnly` one.
 */
export const NOTIFICATION_SWITCHES: readonly {
	field: "accessRequests" | "pendingRevisions" | "grants" | "comments"
	label: string
	hint: string
	teamOnly?: true
}[] = [
	{ field: "accessRequests", label: "Access requests", hint: "Someone asks for access to a file you own." },
	{
		field: "pendingRevisions",
		label: "Approvals",
		hint: "A new revision is waiting for your approval.",
		teamOnly: true,
	},
	{ field: "grants", label: "Shared with you", hint: "Someone shares a file or a folder with you." },
	{ field: "comments", label: "Comments", hint: "Someone else comments on a file you can read." },
]

export const useNotificationSwitches = () => {
	const kind = useWorkspaceKind()
	return NOTIFICATION_SWITCHES.filter((entry) => kind === "team" || !entry.teamOnly)
}

export const useNotificationPreferences = () =>
	useQuery({
		queryKey: QueryKeys.notifications.preferences(),
		queryFn: () => apiClient.notifications.getPreferences(),
	})

/**
 * Saves all four switches at once. The switch moves at once and moves back if the save fails, unless another save is
 * still in flight; once the last of a quick run of saves settles, the server's answer is read back.
 */
export const useSetNotificationPreferences = () => {
	const queryClient = useQueryClient()
	const toast = useToast()
	const queryKey = QueryKeys.notifications.preferences()

	return useMutation({
		mutationKey: queryKey,
		mutationFn: (preferences: NotificationPreferences) => apiClient.notifications.setPreferences(preferences),
		onMutate: async (preferences) => {
			await queryClient.cancelQueries({ queryKey })
			const previous = queryClient.getQueryData<NotificationPreferences>(queryKey)
			queryClient.setQueryData(queryKey, preferences)
			return { previous }
		},
		onError: (error, _preferences, context) => {
			// Here, not in `mutate`'s own callbacks: those reach only the latest call, and an earlier save can fail too.
			toast(error.message)
			// Another save still in flight was built on this one's value; rolling back would undo it on screen. The
			// last save's read-back settles what the server holds.
			if (queryClient.isMutating({ mutationKey: queryKey }) > 1) return
			if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
		},
		onSettled: () => {
			if (queryClient.isMutating({ mutationKey: queryKey }) <= 1) void queryClient.invalidateQueries({ queryKey })
		},
	})
}
