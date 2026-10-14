import { createContext, useContext } from "react"

import { useMe } from "@/features/auth/hooks/useMe"

/** The Workspace `WorkspaceScope` keyed the frame for, which is `undefined` outside it. */
export const ShownWorkspaceContext = createContext<string | undefined>(undefined)

/**
 * What this browser keeps for one person in one Workspace (Activity's read line, Recents) is stored under this, so
 * neither another Workspace nor another person on the same browser reads it.
 */
export const stateScopeOf = (person: { id: string; workspaceId: string }) => `${person.id}.${person.workspaceId}`

/** The scope of the frame this runs in: the Workspace it was keyed for, which `me` may already have moved past. */
export const useStateScope = (): string => {
	const me = useMe().data
	const shown = useContext(ShownWorkspaceContext)
	if (me === undefined) throw new Error("A state scope needs a signed-in session")
	return stateScopeOf({ id: me.id, workspaceId: shown ?? me.workspaceId })
}

/** Whether this frame shows the Workspace the session acts in, which it does not for the commit a switch tears it down in. */
export const useFrameSettled = (): boolean => {
	const me = useMe().data
	const shown = useContext(ShownWorkspaceContext)
	return shown === undefined || me?.workspaceId === shown
}

/** Drops what an earlier version stored under one key for everyone, which nothing reads now. */
export const dropUnscopedKey = (key: string) => {
	try {
		window.localStorage.removeItem(key)
	} catch {
		// Storage can be off.
	}
}
