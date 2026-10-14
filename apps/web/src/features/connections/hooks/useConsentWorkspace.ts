import { type ConsentInfo, type WorkspaceKind } from "@exagram/api-client"
import { useState } from "react"

import { type ConsentMove, type ConsentWorkspace } from "@/features/connections/consentCopy"
import { useLoadedWorkspaceKind } from "@/features/workspace/useWorkspaceKind"

export interface ConsentWorkspaceChoice {
	workspaces: ConsentWorkspace[]
	selected: ConsentWorkspace | undefined
	kind: WorkspaceKind
	picking: boolean
	choose: (workspaceId: string) => void
	approveWorkspaceId: string | undefined
	move: ConsentMove | null
}

export const useConsentWorkspace = (info: ConsentInfo | undefined): ConsentWorkspaceChoice => {
	const sessionKind = useLoadedWorkspaceKind()
	const [chosenId, choose] = useState<string | null>(null)
	const workspaces = info?.workspaces ?? []
	const picking = workspaces.length > 1
	const selected =
		workspaces.find((workspace) => workspace.id === (chosenId ?? info?.defaultWorkspaceId)) ?? workspaces[0]
	const currentId = info?.currentConnectionWorkspaceId ?? null
	const move =
		currentId !== null && selected !== undefined && currentId !== selected.id
			? { from: workspaces.find((workspace) => workspace.id === currentId), to: selected }
			: null

	return {
		workspaces,
		selected,
		kind: selected?.kind ?? sessionKind,
		picking,
		choose,
		approveWorkspaceId: picking ? selected?.id : undefined,
		move,
	}
}
