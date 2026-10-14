import type { WorkspaceKind } from "./auth"

export type { WorkspaceKind }

export const toWorkspaceKind = (value: string): WorkspaceKind => {
	if (value === "personal" || value === "team") return value
	throw new Error(`Unknown Workspace kind: ${value}`)
}
