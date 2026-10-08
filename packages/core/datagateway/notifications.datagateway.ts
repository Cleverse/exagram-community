import type { Notification, NotificationPreferences } from "../entity/notification"

/** A feed row with its own position, created_at in UTC at microsecond precision, for the next page's keyset. */
export interface NotificationRow extends Notification {
	cursorAt: string
}

export interface NotificationsDatagateway {
	/**
	 * What is new for the member from `notBefore` on, oldest first, already filtered by their preferences (ADR 0036,
	 * ADR 0040). With `after`, only rows strictly after that (created_at, id) position.
	 */
	listSince(
		userId: string,
		query: { notBefore: Date; after: { at: string; id: string } | null; workspaceId: string },
		limit: number,
	): Promise<NotificationRow[]>
	/** The database's clock, which stamps every row the feed compares against. */
	now(): Promise<Date>
	/** Null when the member never saved any. Muted folders the member no longer reaches are left out. */
	getPreferences(userId: string, workspaceId: string): Promise<NotificationPreferences | null>
	setPreferences(
		userId: string,
		workspaceId: string,
		preferences: NotificationPreferences,
	): Promise<NotificationPreferences>
}
