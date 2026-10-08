import { type WorkspaceKind } from "@exagram/api-client"

import { useMe } from "@/features/auth/hooks/useMe"

export const useWorkspaceKind = () => useMe().data?.workspaceKind ?? "team"

const NARROWEST_KIND: WorkspaceKind = "personal"

export const useWorkspaceOf = (workspaceId: string | undefined) => {
	const me = useMe().data
	const live = me?.workspaces?.find((workspace) => workspace.id === workspaceId)
	return live === undefined ? { kind: NARROWEST_KIND, member: false } : { kind: live.kind, member: true }
}
