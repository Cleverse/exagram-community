import { PostgresRepository } from "./db"
import {
	clearNotificationMutedProjects,
	getDatabaseNow,
	getNotificationPreferences,
	listNotificationEmailItems,
	listNotificationMutedProjects,
	listNotificationsSince,
	muteNotificationProjects,
	upsertNotificationPreferences,
} from "./gen/exagram_notifications_sql"

import type { GetNotificationPreferencesRow, ListNotificationsSinceRow } from "./gen/exagram_notifications_sql"
import type { NotificationRow, NotificationsDatagateway } from "../../datagateway/notifications.datagateway"
import type { GrantRole } from "../../entity/grant"
import type {
	Notification,
	NotificationFeedFilter,
	NotificationKind,
	NotificationPreferences,
	NotificationRevisionScope,
} from "../../entity/notification"
import type { Sql } from "postgres"

// sqlc types every column of a CTE as nullable, and the Revision number as a string; each branch selects
// NOT NULL id, kind, title and created_at, and postgres.js returns an int4 as a number.
const toRow = (row: ListNotificationsSinceRow): NotificationRow => {
	if (row.id === null || row.kind === null || row.title === null || row.createdAt === null || row.cursorAt === null) {
		throw new Error("notification row is missing a column")
	}
	return {
		id: row.id,
		kind: row.kind as NotificationKind,
		artifactId: row.artifactId,
		projectId: row.projectId,
		title: row.title,
		actorName: row.actorName,
		revision: row.revision === null ? null : Number(row.revision),
		role: row.role as GrantRole | null,
		outcome: row.outcome as Notification["outcome"],
		subject: row.subject as Notification["subject"],
		note: row.note,
		createdAt: row.createdAt,
		cursorAt: row.cursorAt,
	}
}

/** The feed filter of a member who never saved: every kind on, the member revision scope (migrations 000030, 000032). */
const DEFAULT_FILTER: NotificationFeedFilter = {
	accessRequests: true,
	pendingRevisions: true,
	grants: true,
	comments: true,
	decisions: true,
	published: true,
	connections: true,
	revisionScope: "member",
}

interface FeedPage {
	notBefore: Date
	after: { at: string; id: string } | null
}

const feedArgs = (userId: string, page: FeedPage, filter: NotificationFeedFilter, limit: number) => ({
	userId,
	notBefore: page.notBefore,
	afterAt: page.after?.at ?? null,
	afterId: page.after?.id ?? null,
	maxRows: limit,
	accessRequests: filter.accessRequests,
	pendingRevisions: filter.pendingRevisions,
	grants: filter.grants,
	comments: filter.comments,
	decisions: filter.decisions,
	published: filter.published,
	connections: filter.connections,
	revisionScope: filter.revisionScope,
})

/** The app feed: the member's rows in the Workspace their session acts in. */
export async function listNotificationsInWorkspace(
	sql: Sql,
	userId: string,
	query: FeedPage & { workspaceId: string },
	filter: NotificationFeedFilter,
	limit: number,
): Promise<NotificationRow[]> {
	const rows = await listNotificationsSince(sql, {
		...feedArgs(userId, query, filter, limit),
		workspaceId: query.workspaceId,
	})
	return rows.map(toRow)
}

/**
 * Notification Email's rows, across the Workspaces that have email on; the same body as the app feed. The row shape is
 * spelled out here so core depends on none of its consumers.
 */
export async function listNotificationsForEmail(
	sql: Sql,
	userId: string,
	query: FeedPage & { notAfter: Date | null },
	filter: NotificationFeedFilter,
	limit: number,
): Promise<(NotificationRow & { workspaceId: string })[]> {
	const rows = await listNotificationEmailItems(sql, {
		...feedArgs(userId, query, filter, limit),
		notAfter: query.notAfter,
	})
	return rows.flatMap((row) => (row.workspaceId === null ? [] : [{ ...toRow(row), workspaceId: row.workspaceId }]))
}

const toPreferences = (row: GetNotificationPreferencesRow, mutedProjectIds: string[]): NotificationPreferences => ({
	accessRequests: row.accessRequests,
	pendingRevisions: row.pendingRevisions,
	grants: row.grants,
	comments: row.comments,
	decisions: row.decisions,
	published: row.published,
	connections: row.connections,
	recap: row.recap,
	revisionScope: row.revisionScope as NotificationRevisionScope,
	mutedProjectIds,
	quietHours: { enabled: row.quietHours, from: row.quietFrom, to: row.quietTo, urgent: row.quietUrgent },
})

const mutedIds = async (sql: Sql, userId: string, workspaceId: string): Promise<string[]> =>
	(await listNotificationMutedProjects(sql, { userId, workspaceId })).map((row) => row.projectId)

export class NotificationsRepository extends PostgresRepository implements NotificationsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async listSince(
		userId: string,
		query: { notBefore: Date; after: { at: string; id: string } | null; workspaceId: string },
		limit: number,
	): Promise<NotificationRow[]> {
		// The app feed applies the member's app switches; Notification Email passes its own.
		const filter = (await getNotificationPreferences(this.sql, { userId })) ?? DEFAULT_FILTER
		return listNotificationsInWorkspace(
			this.sql,
			userId,
			query,
			{ ...filter, revisionScope: filter.revisionScope as NotificationRevisionScope },
			limit,
		)
	}

	async now(): Promise<Date> {
		const row = await getDatabaseNow(this.sql)
		if (row === null) throw new Error("now() returned no row")
		return row.now
	}

	async getPreferences(userId: string, workspaceId: string): Promise<NotificationPreferences | null> {
		const row = await getNotificationPreferences(this.sql, { userId })
		if (row === null) return null
		return toPreferences(row, await mutedIds(this.sql, userId, workspaceId))
	}

	setPreferences(
		userId: string,
		workspaceId: string,
		preferences: NotificationPreferences,
	): Promise<NotificationPreferences> {
		const { mutedProjectIds, quietHours, ...switches } = preferences
		return this.sql.begin(async (tx) => {
			const row = await upsertNotificationPreferences(tx, {
				userId,
				...switches,
				quietHours: quietHours.enabled,
				quietFrom: quietHours.from,
				quietTo: quietHours.to,
				quietUrgent: quietHours.urgent,
			})
			if (row === null) throw new Error("notification preferences upsert returned no row")
			await clearNotificationMutedProjects(tx, { userId, workspaceId })
			await muteNotificationProjects(tx, { userId, workspaceId, projectIds: mutedProjectIds })
			return toPreferences(row, await mutedIds(tx, userId, workspaceId))
		})
	}
}
