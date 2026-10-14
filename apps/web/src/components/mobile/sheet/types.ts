import { type WorkspaceKind } from "@exagram/api-client"
import { type ComponentType } from "react"

/** What a Share or Role drawer is about: one Artifact or one Project. */
export type ShareTarget = { kind: "artifact"; id: string } | { kind: "project"; id: string }

/**
 * Every bottom drawer the mobile screens open (README "Drawer (bottom sheet) spec"), with what each needs.
 * A screen opens one by kind; the drawer itself lives in `src/features/<area>/sheets/<kind>.sheet.mobile.tsx`,
 * so a screen and its drawers are built and tested apart.
 */
export type SheetParams = {
	/** File actions: open, share, pin, move, history, details, delete. */
	file: { artifactId: string }
	share: { target: ShareTarget }
	/** One person's role on a Share target, with Remove access. */
	role: { target: ShareTarget; granteeKey: string; kind: WorkspaceKind }
	move: { artifactId: string }
	details: { artifactId: string }
	history: { artifactId: string }
	/** A Pending Revision's content, with Reject / Approve for its Owner. */
	pendingPreview: { revisionId: string }
	/** A Project's rules: its policy text and publishing mode. */
	rules: { projectId: string }
	/** Project actions: share, rules, rename, new folder, delete. */
	project: { projectId: string }
	/** Create: Upload file, New folder, New chat. */
	new: { projectId: string | null }
	newProject: { parentId: string | null }
	/** Full-height search that focuses its field after 260ms. */
	search: Record<string, never>
	/** A Connection's scopes, folder access, redaction and Revoke. */
	client: { connectionId: string }
	clientFolders: { connectionId: string; connectionName: string }
	/** Account and organisation, with Connections, Settings and Sign out. */
	account: Record<string, never>
	workspaces: Record<string, never>
	createTeam: Record<string, never>
	/** Settings → General: the typed-email confirmation before the account is deleted for good. */
	deleteAccount: Record<string, never>
	teamInvite: Record<string, never>
	memberRole: { userId: string }
	memberRemove: { userId: string }
	memberDemote: { userId: string }
	groupNew: Record<string, never>
	groupEdit: { groupId: string }
	groupDelete: { groupId: string }
}

export type SheetKind = keyof SheetParams

export const SHEET_KINDS = [
	"file",
	"share",
	"role",
	"move",
	"details",
	"history",
	"pendingPreview",
	"rules",
	"project",
	"new",
	"newProject",
	"search",
	"client",
	"clientFolders",
	"account",
	"workspaces",
	"createTeam",
	"deleteAccount",
	"teamInvite",
	"memberRole",
	"memberRemove",
	"memberDemote",
	"groupNew",
	"groupEdit",
	"groupDelete",
] as const satisfies readonly SheetKind[]

/** A drawer module's default export. It renders a `<Sheet>` with its own title and body. */
export type SheetComponent<K extends SheetKind> = ComponentType<{ params: SheetParams[K] }>

export type SheetEntry = { [K in SheetKind]: { kind: K; params: SheetParams[K]; key: number } }[SheetKind]
