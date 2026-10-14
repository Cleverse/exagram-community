import { type WorkspaceKind } from "@exagram/api-client"

export const meActingIn = (
	current: { id: string; kind: WorkspaceKind },
	others: { id: string; kind: WorkspaceKind }[] = [],
) => ({
	workspaceId: current.id,
	workspaceName: current.kind === "personal" ? "Personal" : "Cleverse",
	workspaceKind: current.kind,
	workspaces: [current, ...others].map((workspace) => ({
		...workspace,
		name: workspace.kind === "personal" ? "Personal" : "Cleverse",
		role: "admin" as const,
	})),
})

export const sessionIn = (
	kind: WorkspaceKind,
	workspaceId: string,
	name = kind === "personal" ? "Personal" : "Cleverse",
) => ({
	workspaceId,
	workspaceName: name,
	workspaceKind: kind,
	workspaces: [{ id: workspaceId, kind, name, role: "admin" as const }],
})
