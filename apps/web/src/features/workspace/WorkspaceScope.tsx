import { useQueryClient } from "@tanstack/react-query"
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { QueryKeys } from "@/config/queryKeys"
import { useMe } from "@/features/auth/hooks/useMe"
import { dropSessionQueries } from "@/features/auth/hooks/useSignIn"
import { ShownWorkspaceContext } from "@/features/workspace/stateScope"
import { onSwitchElsewhere } from "@/features/workspace/workspaceChannel"
import { paths } from "@/routes/paths"

/**
 * Everything below shows one Workspace: the one `me` says the session acts in. When that changes, whether this
 * tab switched or another tab moved the shared session, the old Workspace's answers go, the tab lands on
 * Activity, and the frame (the live feed included) mounts again for the new one. The old frame stays until
 * Activity is the address and its answers are dropped only then, so the new frame never starts from the old cache.
 */
export const WorkspaceScope = ({ children }: { children: ReactNode }) => {
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const { pathname, search } = useLocation()
	const workspaceId = useMe().data?.workspaceId
	const [shown, setShown] = useState(workspaceId)
	if (shown === undefined && workspaceId !== undefined) setShown(workspaceId)
	const moving = shown !== undefined && workspaceId !== undefined && shown !== workspaceId
	const arrived = pathname === paths.activity && search === ""

	useEffect(
		() => onSwitchElsewhere(() => void queryClient.invalidateQueries({ queryKey: QueryKeys.auth.me() })),
		[queryClient],
	)

	useEffect(() => {
		if (moving && !arrived) void navigate(paths.activity, { replace: true })
	}, [moving, arrived, navigate])

	useLayoutEffect(() => {
		if (!moving || !arrived) return
		dropSessionQueries(queryClient)
		setShown(workspaceId)
	}, [moving, arrived, queryClient, workspaceId])

	return (
		<ShownWorkspaceContext.Provider value={shown}>
			<Fragment key={shown}>{children}</Fragment>
		</ShownWorkspaceContext.Provider>
	)
}
