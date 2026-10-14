import { type ConsentInfo, type WorkspaceKind } from "@exagram/api-client"

export type ConsentWorkspace = ConsentInfo["workspaces"][number]

const SCOPE_COPY: Record<string, string> = {
	read: "Read every Artifact you can reach",
	manage: "Remove or change Grants on Artifacts you own",
}

const WRITE_COPY: Record<WorkspaceKind, string> = {
	team: "Write Revisions to Artifacts and folders you can edit, other Owners' included. Some wait for the Owner's approval first.",
	personal:
		"Write new Revisions to Artifacts and folders you can edit. In your own files they become the Current Revision at once.",
}

export const scopeCopy = (scope: string, kind: WorkspaceKind): string =>
	scope === "write" ? WRITE_COPY[kind] : (SCOPE_COPY[scope] ?? scope)

export const CONSENT_WRITE_NOTE: Record<WorkspaceKind, string> = {
	team: "Whether a write goes live at once or waits for the Owner depends on the file's or folder's publish setting and on your access. It can read back what it wrote while it waits.",
	personal:
		"What it writes to your own files becomes the Current Revision at once. Files shared with you from a Team keep that Team's approvals.",
}

export const workspaceTitle = (workspace: ConsentWorkspace) =>
	workspace.kind === "personal" ? "Personal" : workspace.name

export const workspaceSummary = (workspace: ConsentWorkspace) =>
	workspace.kind === "personal"
		? "Your own files, and files shared with you from Workspaces you are not a member of."
		: "Everything you can see in this Team."

export const consentReachCopy = ({
	workspace,
	namedFolders,
	moving,
}: {
	workspace: ConsentWorkspace | undefined
	namedFolders: boolean
	moving: boolean
}) => {
	if (namedFolders) {
		return moving
			? "This Connection stays limited to named folders; change them in Connections → Folder access."
			: "This Connection stays limited to the folders you chose; change them in Connections → Folder access."
	}
	const reach =
		workspace?.kind === "personal"
			? "It reaches the files in your Personal Workspace, and files shared with you from Workspaces you are not a member of"
			: `It reaches the files you can see in ${workspace?.name ?? "your Workspace"}`
	return `${reach}; you can narrow it to named folders afterwards in Connections.`
}

export interface ConsentMove {
	from: ConsentWorkspace | undefined
	to: ConsentWorkspace
}

export const consentMoveNote = ({
	clientName,
	move,
	namedFolders,
}: {
	clientName: string
	move: ConsentMove
	namedFolders: boolean
}) => {
	const was = move.from ? workspaceTitle(move.from) : "a Workspace you are no longer in"
	const that = move.from ? workspaceTitle(move.from) : "that Workspace"
	const note = `${clientName} is connected to ${was}. Allowing it here moves it to ${workspaceTitle(move.to)}, and it stops reaching ${that}.`
	return namedFolders
		? `${note} The folders you named belong to ${that}, so they are cleared; pick new ones in Connections → Folder access.`
		: note
}
