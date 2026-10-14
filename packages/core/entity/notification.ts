import type { GrantRole } from "./grant"

export type NotificationKind =
	| "accessRequest"
	| "pendingRevision"
	| "grant"
	| "comment"
	| "decision"
	| "published"
	| "connection"

/** Which folders `published` follows. */
export type NotificationRevisionScope = "all" | "member" | "mine"

/** Something new for a member, as metadata only. */
export interface Notification {
	/** The source row's id: the Access Request, Revision, Grant, comment or Connection. */
	id: string
	kind: NotificationKind
	/** Null for a grant on a folder and for a connection. */
	artifactId: string | null
	/** Set only for a grant on a folder. */
	projectId: string | null
	/** The Artifact's title, the folder's name or the Connection's name; empty for a declined access decision. */
	title: string
	/** Null where the member does not see the actor named elsewhere, and for a connection or a declined decision. */
	actorName: string | null
	/** The Revision's number, for pendingRevision, published and a revision decision. */
	revision: number | null
	/** Requested, for an accessRequest; granted, for a granted access decision. */
	role: GrantRole | null
	/** For a decision. */
	outcome: "granted" | "declined" | "approved" | "discarded" | null
	/** For a decision. */
	subject: "accessRequest" | "revision" | null
	/** The requester's note, for an accessRequest. */
	note: string | null
	createdAt: Date
}

/** Quiet hours, evaluated by each device in its own time zone. Times are "HH:MM". */
export interface QuietHours {
	enabled: boolean
	from: string
	to: string
	/** Whether approval and access requests get through. */
	urgent: boolean
}

/** The four original kinds, which Notification Email also switches. */
export interface NotificationKindSwitches {
	accessRequests: boolean
	pendingRevisions: boolean
	grants: boolean
	comments: boolean
}

/** What the feed query filters by, besides muted folders, which it reads itself. */
export interface NotificationFeedFilter extends NotificationKindSwitches {
	decisions: boolean
	published: boolean
	connections: boolean
	revisionScope: NotificationRevisionScope
}

/** A member's account-level Notification Preferences. A member who never saved has the defaults. */
export interface NotificationPreferences extends NotificationFeedFilter {
	recap: boolean
	/** Folders, with their subfolders, that send nothing but a declined access decision. */
	mutedProjectIds: string[]
	quietHours: QuietHours
}
