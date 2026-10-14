import { z } from "zod"

import { GrantRoleSchema } from "../grants/type"

/** What a Notification is about. Each kind is one switch in Notification Preferences. */
export const NotificationKindSchema = z.enum([
	"accessRequest",
	"pendingRevision",
	"grant",
	"comment",
	"decision",
	"published",
	"connection",
])
export type NotificationKind = z.infer<typeof NotificationKindSchema>

/**
 * Which folders `published` follows: `all` every folder the member can open, `member` folders they own or
 * hold a Grant on and files shared with them directly, `mine` none. The revision scope narrows `published` only.
 */
export const NotificationRevisionScopeSchema = z.enum(["all", "member", "mine"])

const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time as HH:MM.")

/** Kept on the server so every device shares them; each device evaluates them in its own time zone. */
export const QuietHoursSchema = z.object({
	enabled: z.boolean(),
	from: TimeOfDaySchema,
	to: TimeOfDaySchema,
	/** Whether approval and access requests get through. */
	urgent: z.boolean(),
})

export const NOTIFICATION_MUTED_PROJECTS_MAX = 500

/** The member's Notification Preferences. A member who never saved any has the defaults. */
export const NotificationPreferencesSchema = z.object({
	accessRequests: z.boolean(),
	pendingRevisions: z.boolean(),
	grants: z.boolean(),
	comments: z.boolean(),
	decisions: z.boolean(),
	published: z.boolean(),
	connections: z.boolean(),
	/** Read by devices only: each schedules its own weekly recap. */
	recap: z.boolean(),
	revisionScope: NotificationRevisionScopeSchema,
	/**
	 * Folders whose Artifacts, and their subfolders' Artifacts, send nothing but a declined access decision. Only folders
	 * the member can see are kept; any other id is dropped without a word.
	 */
	mutedProjectIds: z.array(z.uuid()).max(NOTIFICATION_MUTED_PROJECTS_MAX),
	quietHours: QuietHoursSchema,
})
export type NotificationPreferencesView = z.infer<typeof NotificationPreferencesSchema>

/**
 * A PUT replaces the whole object. An older client sends only the first four switches; each field it leaves out keeps
 * its saved value.
 */
export const SetNotificationPreferencesBodySchema = NotificationPreferencesSchema.partial({
	decisions: true,
	published: true,
	connections: true,
	recap: true,
	revisionScope: true,
	mutedProjectIds: true,
	quietHours: true,
})

/**
 * Something new for the caller, as metadata only: never a comment body or Revision content, so
 * listing it serves nothing and writes no Ledger row. Already filtered by Notification Preferences.
 */
export const NotificationSchema = z.object({
	/** The source row's id (Access Request, Revision, Grant, comment or Connection); unique within its kind. */
	id: z.uuid(),
	kind: NotificationKindSchema,
	/** Null for a `grant` on a folder and for a `connection`. */
	artifactId: z.uuid().nullable(),
	/** Set only for a `grant` on a folder. */
	projectId: z.uuid().nullable(),
	/**
	 * The Artifact's title, the folder's name or the Connection's name. Empty for a declined access `decision`, which
	 * names neither the file nor its Owner.
	 */
	title: z.string(),
	/**
	 * Who did it: the requester, the Revision's author (or the caller's own Connection that wrote it), the Grant's
	 * creator, the commenter, or the Owner who answered a `decision`. Null where the caller does not see that person
	 * named in a list (a `grant` or `published` actor who is neither the Owner nor in the member list, or a folder
	 * Owner who approved a Revision in a folder the caller does not reach), and for a `connection` or a declined
	 * access `decision`.
	 */
	actorName: z.string().nullable(),
	/** The Revision's number, for `pendingRevision`, `published` and a revision `decision`. */
	revision: z.number().int().nullable(),
	/** The role requested, for `accessRequest`; the role granted, for a granted access `decision`. */
	role: GrantRoleSchema.nullable(),
	/**
	 * For a `decision`, one enum for both subjects: an Access Request is `granted` or `declined`, a Revision `approved`
	 * or `discarded`.
	 */
	outcome: z.enum(["granted", "declined", "approved", "discarded"]).nullable(),
	/** For a `decision`. */
	subject: z.enum(["accessRequest", "revision"]).nullable(),
	/** The requester's note, for `accessRequest` only. */
	note: z.string().nullable(),
	createdAt: z.date(),
})
export type NotificationView = z.infer<typeof NotificationSchema>

export const NOTIFICATIONS_LIMIT = 50

export const ListNotificationsQuerySchema = z.object({
	/**
	 * Items created at or after this; a device asks from a little before its last call and drops ids it has seen. A
	 * time earlier than 7 days before the server's clock counts as 7 days before it. Absent (and no `after`): no items,
	 * just `serverTime`, so a new device starts from now.
	 */
	since: z.coerce.date().optional(),
	/** The `next` of the previous page, to read on after it. Takes precedence over `since`; opaque. */
	after: z.string().min(1).max(200).optional(),
})

export const NotificationListSchema = z.object({
	/** Oldest first, at most NOTIFICATIONS_LIMIT. */
	items: z.array(NotificationSchema),
	/** The server's clock, for a device's first cursor. */
	serverTime: z.date(),
	/** Set only when the page is full and more items may follow: pass it back as `after`. */
	next: z.string().nullable(),
})
