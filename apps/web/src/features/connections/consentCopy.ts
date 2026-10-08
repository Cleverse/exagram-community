import { type WorkspaceKind } from "@exagram/api-client"

const SCOPE_COPY: Record<string, string> = {
	read: "Read every Artifact you can reach",
	manage: "Remove or change Grants on Artifacts you own",
}

const WRITE_COPY: Record<WorkspaceKind, string> = {
	team: "Write Pending Revisions to Artifacts and Projects you can edit, other Owners' included. The Owner approves each one.",
	personal:
		"Write new Revisions to Artifacts and Projects you can edit. In your own files they become the Current Revision at once.",
}

export const scopeCopy = (scope: string, kind: WorkspaceKind): string =>
	scope === "write" ? WRITE_COPY[kind] : (SCOPE_COPY[scope] ?? scope)

export const CONSENT_WRITE_NOTE: Record<WorkspaceKind, string> = {
	team: "Nothing it writes becomes the Current Revision on its own: the Owner approves it first. It can read back Pending Revisions it wrote.",
	personal:
		"What it writes to your own files becomes the Current Revision at once. Files shared with you from a Team keep that Team's approvals.",
}

export const CONSENT_REACH_COPY = {
	named: "This client stays limited to the folders you chose; change them in MCP → Folder access.",
	all: "It reaches everything you can see in Shares; you can narrow it to named folders afterwards in MCP.",
}
