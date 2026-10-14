import { useMutation, useQuery } from "@tanstack/react-query"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { memberCountLabel } from "@/features/settings/team/teamModel"
import { useInvalidate } from "@/utils/react-query"

const ACCESS_QUERY_KEYS = [["projects"], ["artifacts"], ["grants"]]

export const useGroups = () =>
	useQuery({ queryKey: QueryKeys.workspace.groups(), queryFn: () => apiClient.groups.list() })

export const useUpsertGroup = () => {
	const invalidate = useInvalidate()
	const toast = useToast()
	return useMutation({
		mutationFn: (input: { id?: string; name: string; memberIds: string[] }) =>
			input.id === undefined
				? apiClient.groups.create({ name: input.name, memberIds: input.memberIds })
				: apiClient.groups.update({ id: input.id, name: input.name, memberIds: input.memberIds }),
		onSuccess: (group, input) => {
			invalidate(
				input.id === undefined ? [QueryKeys.workspace.groups()] : [QueryKeys.workspace.groups(), ...ACCESS_QUERY_KEYS],
			)
			toast(
				input.id === undefined
					? `${group.name} created with ${memberCountLabel(group.memberCount)}.`
					: `${group.name} updated — access through this group follows the new member list.`,
			)
		},
	})
}

export const useDeleteGroup = () => {
	const invalidate = useInvalidate()
	const toast = useToast()
	return useMutation({
		mutationFn: (input: { id: string; name: string }) => apiClient.groups.delete({ id: input.id }),
		onSuccess: (_result, input) => {
			invalidate([QueryKeys.workspace.groups(), ...ACCESS_QUERY_KEYS])
			toast(`${input.name} deleted — access given through this group is removed.`)
		},
		onError: (error) => toast(error.message),
	})
}
