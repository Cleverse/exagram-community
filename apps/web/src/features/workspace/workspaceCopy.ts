import type { WorkspaceKind } from "@exagram/api-client"

import type { EditionCopy } from "@/edition/edition.port"

/** The sentences that name the Workspace, the same in both editions. */
export const workspaceCopy: Pick<
	EditionCopy,
	| "accountWorkspace"
	| "joinTitle"
	| "joinLine"
	| "resetLine"
	| "newTo"
	| "notInYet"
	| "notInYetSendLink"
	| "removeMemberTitle"
	| "removeMemberLabel"
	| "inviteRefused"
> = {
	accountWorkspace: (workspaceName) => workspaceName ?? "",
	joinTitle: (workspaceName) => `Join ${workspaceName}`,
	joinLine: (workspaceName, role) =>
		`You're invited to ${workspaceName} as ${role === "admin" ? "an Admin" : "a Member"}.`,
	resetLine: (workspaceName) =>
		`Set a new password for your ${workspaceName} account. You'll be signed out of every other browser.`,
	newTo: (workspaceName) => `New to ${workspaceName ?? "your workspace"}`,
	notInYet: (workspaceName) => `Not in ${workspaceName ?? "your workspace"} yet`,
	notInYetSendLink: (workspaceName) => `Not in ${workspaceName ?? "your workspace"} yet — send them the link`,
	removeMemberTitle: "Remove from workspace",
	removeMemberLabel: (memberName) => `Remove ${memberName} from workspace`,
	inviteRefused: "You can no longer invite people to this workspace.",
}

/** The muted line under the wordmark: "Personal Workspace", or the Team's name. */
export const accountLine = (kind: WorkspaceKind | undefined, workspaceName: string | undefined) =>
	kind === undefined ? "" : kind === "personal" ? "Personal Workspace" : `${workspaceName ?? ""} · Team`
