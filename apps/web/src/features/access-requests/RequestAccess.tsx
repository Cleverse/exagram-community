import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { useToast } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { RequestAccessCard, type RequestAccessView } from "@/features/access-requests/RequestAccessCard"
import { useMyAccessRequest } from "@/features/access-requests/useMyAccessRequest"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSignOut } from "@/features/auth/hooks/useSignIn"
import { useLoadedWorkspaceKind } from "@/features/workspace/useWorkspaceKind"

/**
 * Request access for a refused address. It shows for every refused file and asks the server nothing to decide that,
 * and its answer never says whether the file exists: a refusal says nothing. A Grant answer asks the page for the
 * file again; the page then opens it behind the approval card (`ApprovedGate`).
 */
export const RequestAccess = ({ artifactId }: { artifactId: string }) => {
	const me = useMe().data
	const kind = useLoadedWorkspaceKind()
	const toast = useToast()
	const signOut = useSignOut()
	const queryClient = useQueryClient()
	const { sent, answer, canRemind, send, remind, cancel } = useMyAccessRequest(artifactId)

	const granted = answer?.outcome === "granted"
	useEffect(() => {
		if (granted) void queryClient.invalidateQueries({ queryKey: QueryKeys.artifacts.get(artifactId) })
	}, [granted, queryClient, artifactId])

	const busy = send.isPending || remind.isPending || cancel.isPending
	const error = (send.error ?? remind.error ?? cancel.error)?.message ?? null

	const view: RequestAccessView =
		sent === undefined
			? {
					state: "request",
					kind,
					email: me?.email ?? "",
					busy,
					error,
					onSend: (input) => {
						remind.reset()
						cancel.reset()
						send.mutate(input)
					},
					onSwitchAccount: () => signOut.mutate(),
				}
			: answer?.outcome === "declined"
				? { state: "declined" }
				: send.isSuccess
					? { state: "sent" }
					: {
							state: "pending",
							sent,
							canRemind,
							busy,
							error,
							onRemind: () => {
								send.reset()
								cancel.reset()
								remind.mutate(sent, { onSuccess: () => toast("Reminder sent.") })
							},
							onCancel: () => {
								send.reset()
								remind.reset()
								cancel.mutate(undefined, { onSuccess: () => toast("Request canceled.") })
							},
						}

	return <RequestAccessCard view={view} />
}
