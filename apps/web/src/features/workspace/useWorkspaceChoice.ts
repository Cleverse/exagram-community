import { useMe } from "@/features/auth/hooks/useMe"
import { useCreateTeamEntry } from "@/features/workspace/CreateTeamEntry"
import { type SwitcherEntry, switcherEntries } from "@/features/workspace/switcherEntries"
import { useSwitchWorkspace } from "@/features/workspace/useSwitchWorkspace"

export const useWorkspaceChoice = () => {
	const me = useMe().data
	const createTeam = useCreateTeamEntry()
	const switchWorkspace = useSwitchWorkspace()
	const entries = me ? switcherEntries(me, createTeam.available) : []

	const choose = (entry: SwitcherEntry) => {
		if (entry.kind === "createTeam") createTeam.open()
		else if (!entry.current && !switchWorkspace.isPending) switchWorkspace.mutate(entry.id)
	}
	return { entries, choose, dialog: createTeam.dialog }
}
