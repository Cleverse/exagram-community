import { NOTIFICATIONS_LIMIT } from "@exagram/core/contract/notifications/type"
import { BadRequestError } from "@exagram/core/utils/errors"

import type { NotificationRow, NotificationsDatagateway } from "@exagram/core/datagateway/notifications.datagateway"
import type { User } from "@exagram/core/entity/auth"
import type { Notification, NotificationPreferences } from "@exagram/core/entity/notification"

/** What a member who never saved has: the column defaults of migrations 000030 and 000032. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
	accessRequests: true,
	pendingRevisions: true,
	grants: true,
	comments: true,
	decisions: true,
	published: true,
	connections: true,
	recap: false,
	revisionScope: "member",
	mutedProjectIds: [],
	quietHours: { enabled: true, from: "22:00", to: "08:00", urgent: true },
}

/** A PUT from a client that predates ADR 0040 carries only the first four switches. */
export type NotificationPreferencesInput = Pick<
	NotificationPreferences,
	"accessRequests" | "pendingRevisions" | "grants" | "comments"
> &
	Partial<NotificationPreferences>

/** How far back `since` may reach; anything earlier counts as this far back. */
const SINCE_FLOOR_MS = 7 * 24 * 60 * 60 * 1000

const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const encodeCursor = (row: NotificationRow): string => Buffer.from(`${row.cursorAt}|${row.id}`).toString("base64url")

const decodeCursor = (cursor: string): { at: string; id: string } => {
	const [at, id, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|")
	if (at === undefined || id === undefined || rest.length > 0 || !CURSOR_AT.test(at) || !UUID.test(id)) {
		throw new BadRequestError("This notifications cursor is not one the server gave out.")
	}
	return { at, id }
}

/**
 * The Notification feed and Notification Preferences (ADR 0036). The SQL decides each kind and applies the
 * preferences; this layer fills the defaults, clamps how far back a call reaches and pages by keyset.
 */
export class NotificationsUsecase {
	constructor(private readonly notifications: NotificationsDatagateway) {}

	/**
	 * `serverTime` and the 7-day floor use the database's clock, not this process's: every `created_at` they are
	 * compared with was stamped by it. `after` (a previous page's `next`) takes precedence over `since`; `next` is set
	 * only when the page is full.
	 */
	async list(
		user: Pick<User, "id" | "workspaceId">,
		query: { since?: Date; after?: string },
	): Promise<{ items: Notification[]; serverTime: Date; next: string | null }> {
		const serverTime = await this.notifications.now()
		const after = query.after === undefined ? null : decodeCursor(query.after)
		const from = after !== null ? new Date(after.at) : query.since
		if (from === undefined) return { items: [], serverTime, next: null }

		const floor = new Date(serverTime.getTime() - SINCE_FLOOR_MS)
		const notBefore = from < floor ? floor : from
		const rows = await this.notifications.listSince(
			user.id,
			{ notBefore, after, workspaceId: user.workspaceId },
			NOTIFICATIONS_LIMIT,
		)
		const last = rows.at(-1)
		return {
			items: rows.map(
				({ id, kind, artifactId, projectId, title, actorName, revision, role, outcome, subject, note, createdAt }) => ({
					id,
					kind,
					artifactId,
					projectId,
					title,
					actorName,
					revision,
					role,
					outcome,
					subject,
					note,
					createdAt,
				}),
			),
			serverTime,
			next: rows.length === NOTIFICATIONS_LIMIT && last !== undefined ? encodeCursor(last) : null,
		}
	}

	async getPreferences(user: Pick<User, "id" | "workspaceId">): Promise<NotificationPreferences> {
		return (await this.notifications.getPreferences(user.id, user.workspaceId)) ?? DEFAULT_PREFERENCES
	}

	/** Replaces the whole object; a field left out keeps its saved value (or its default). */
	async setPreferences(
		user: Pick<User, "id" | "workspaceId">,
		preferences: NotificationPreferencesInput,
	): Promise<NotificationPreferences> {
		const saved = await this.getPreferences(user)
		const given = Object.fromEntries(Object.entries(preferences).filter(([, value]) => value !== undefined))
		return this.notifications.setPreferences(user.id, user.workspaceId, { ...saved, ...given })
	}
}
