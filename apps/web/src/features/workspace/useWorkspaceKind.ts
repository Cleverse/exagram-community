import { type WorkspaceKind } from "@exagram/api-client"

import { useMe } from "@/features/auth/hooks/useMe"

/**
 * The kind of Workspace the session acts in, or `undefined` until `me` has loaded. Team-only UI gates on
 * `=== "team"` and Personal-only UI on `=== "personal"`, so neither flashes before the server has said which.
 */
export const useWorkspaceKind = (): WorkspaceKind | undefined => useMe().data?.workspaceKind

const NARROWEST_KIND: WorkspaceKind = "personal"

/** For screens that render only once `me` has loaded (the auth guard holds them back), so the kind is never absent. */
export const useLoadedWorkspaceKind = (): WorkspaceKind => useWorkspaceKind() ?? NARROWEST_KIND

export const useWorkspaceOf = (workspaceId: string | undefined) => {
	const me = useMe().data
	const live = me?.workspaces?.find((workspace) => workspace.id === workspaceId)
	return live === undefined ? { kind: NARROWEST_KIND, member: false } : { kind: live.kind, member: true }
}
