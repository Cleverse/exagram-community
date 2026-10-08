import { type MemberRole } from "@exagram/api-client"
import { useMutation, useQuery } from "@tanstack/react-query"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useMe } from "@/features/auth/hooks/useMe"
import { useInvalidate } from "@/utils/react-query"

export const useMembers = () =>
	useQuery({ queryKey: QueryKeys.workspace.members(), queryFn: () => apiClient.workspace.listMembers() })

export const useSetMemberRole = () => {
	const invalidate = useInvalidate()
	const toast = useToast()
	const me = useMe()
	return useMutation({
		mutationFn: (input: { userId: string; name: string; role: MemberRole }) =>
			apiClient.workspace.setMemberRole({ userId: input.userId, role: input.role }),
		onSuccess: (_member, input) => {
			// Invites are Admin-only; refetching them while the page still thinks you are an Admin would 404.
			const demotedYourself = input.userId === me.data?.id && input.role === "member"
			invalidate([
				QueryKeys.workspace.members(),
				QueryKeys.auth.me(),
				QueryKeys.workspace.seats(),
				...(demotedYourself ? [] : [QueryKeys.workspace.invites()]),
			])
			toast(`${input.name} is now ${input.role === "admin" ? "an Admin" : "a Member"}.`)
		},
		onError: (error) => toast(error.message),
	})
}

export const useRemoveMember = () => {
	const invalidate = useInvalidate()
	const toast = useToast()
	return useMutation({
		mutationFn: (input: { userId: string; name: string; transferTo?: string }) =>
			apiClient.workspace.removeMember({ userId: input.userId, transferTo: input.transferTo }),
		onSuccess: (result, input) => {
			if (!result.removed) return
			invalidate([
				QueryKeys.workspace.members(),
				QueryKeys.workspace.seats(),
				QueryKeys.workspace.invites(),
				["projects"],
				["artifacts"],
				["grants"],
			])
			toast(`${input.name} removed — their Grants and connections are removed.`)
		},
	})
}
