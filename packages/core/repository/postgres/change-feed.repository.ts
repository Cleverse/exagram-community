import { type Sql } from "postgres"

import { CHANGE_CHANNEL, type ChangeFeedDeps, WEB_DEPLOYED_NOTICE } from "../../services/change-feed.port"

import { listArtifactAudience } from "./gen/exagram_change_feed_sql"

/**
 * The ChangeFeed's two touch points with Postgres. `listen` holds one dedicated connection outside
 * the pool's query slots; postgres.js reconnects it by itself and calls `onListen` again each time.
 */
export function createPostgresChangeFeedDeps(sql: Sql): ChangeFeedDeps {
	return {
		async listen(channel, onNotify, onListen) {
			const meta = await sql.listen(channel, onNotify, onListen)
			return { unlisten: () => meta.unlisten() }
		},

		async audience(artifactId, workspaceId) {
			const rows = await listArtifactAudience(sql, { artifactId, workspaceId })
			return rows.map((row) => ({ userId: row.userId, member: row.member }))
		},
	}
}

/** Tells every api process's feed that a web build went live; each passes it on to its open streams. */
export async function notifyWebDeployed(sql: Sql): Promise<void> {
	await sql.notify(CHANGE_CHANNEL, WEB_DEPLOYED_NOTICE)
}
