import { type LiveWorkspace, type Me } from "@exagram/api-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ALREADY_IN_TEAM_CREATE, isAlreadyInTeam } from "@/features/auth/authErrors"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSwitchWorkspace } from "@/features/workspace/useSwitchWorkspace"

export const CREATE_TEAM_HELP = "You'll be its Workspace Owner. Your Personal Workspace stays yours."

export const canCreateTeam = (me: Pick<Me, "workspaceKind" | "workspaces"> | undefined): boolean =>
	me !== undefined && me.workspaceKind === "personal" && me.workspaces.every((workspace) => workspace.kind !== "team")

export const useCanCreateTeam = (): boolean => canCreateTeam(useMe().data)

const createTeamMessage = (error: Error): string => (isAlreadyInTeam(error) ? ALREADY_IN_TEAM_CREATE : error.message)

const useEnterTeam = () => {
	const queryClient = useQueryClient()
	const switchWorkspace = useSwitchWorkspace()
	const toast = useToast()

	return async (team: LiveWorkspace) => {
		const entered = await switchWorkspace.mutateAsync(team.id).then(
			() => true,
			() => false,
		)
		if (entered) {
			toast(`You're in ${team.name}, as its Workspace Owner.`)
			return
		}
		void queryClient.invalidateQueries({ queryKey: QueryKeys.auth.me() })
		toast(`${team.name} was created. Switch to it from the workspace menu.`)
	}
}

/**
 * `settle` gets the step that moves the session into the new Team and decides when to run it: a dialog runs it at
 * once, a drawer closes first so its history entry goes before the switch navigates.
 */
export const useCreateTeamForm = (settle: (enter: () => Promise<void>) => void) => {
	const queryClient = useQueryClient()
	const toast = useToast()
	const enterTeam = useEnterTeam()
	const [name, setName] = useState("")
	const [entering, setEntering] = useState(false)
	const mounted = useRef(true)
	const refused = useRef(false)

	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			if (refused.current) void queryClient.invalidateQueries({ queryKey: QueryKeys.auth.me() })
		}
	}, [queryClient])

	const create = useMutation({
		mutationFn: (teamName: string) => apiClient.workspace.createTeam({ name: teamName }),
		onSuccess: (team) => {
			setEntering(true)
			settle(() => enterTeam(team))
		},
		onError: (error) => {
			refused.current = isAlreadyInTeam(error)
			if (!mounted.current) toast(createTeamMessage(error))
		},
	})
	const trimmed = name.trim()
	const pending = create.isPending || entering
	const canSubmit = trimmed !== "" && !pending

	return {
		name,
		setName,
		canSubmit,
		pending,
		error: create.isError ? createTeamMessage(create.error) : null,
		submit: () => {
			if (canSubmit) create.mutate(trimmed)
		},
	}
}
