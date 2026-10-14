import { createPostgresChangeFeedDeps } from "../repository/postgres/change-feed.repository"
import { CHANGE_CHANNEL, type ChangeNotice, ChangeNoticeSchema } from "../services/change-feed.port"

import type { SharingFixture } from "./sharing-fixtures"
import type { Sql } from "postgres"

const FLUSH = "flush"

/**
 * LISTENs through the adapter under test. `drain()` sends a marker notice and waits for it: NOTIFY
 * is delivered in commit order, so everything committed before the marker has arrived by then, and
 * "nothing arrived" is a real assertion rather than a timeout.
 */
export const listenNotices = async (sql: Sql) => {
	const received: string[] = []
	let onMarker: (() => void) | null = null
	const deps = createPostgresChangeFeedDeps(sql)
	const { unlisten } = await deps.listen(
		CHANGE_CHANNEL,
		(payload) => {
			if (payload === FLUSH) onMarker?.()
			else received.push(payload)
		},
		() => {},
	)
	const drainRaw = async (): Promise<unknown[]> => {
		const arrived = new Promise<void>((resolve) => (onMarker = resolve))
		await sql`SELECT pg_notify(${CHANGE_CHANNEL}, ${FLUSH})`
		await arrived
		return received.splice(0).map((raw): unknown => JSON.parse(raw))
	}
	const drain = async (): Promise<ChangeNotice[]> =>
		(await drainRaw()).map((payload) => ChangeNoticeSchema.parse(payload))
	return { drain, drainRaw, unlisten }
}

export const notice = (fx: SharingFixture, over: Partial<ChangeNotice>): ChangeNotice => ({
	w: fx.workspaceId,
	a: fx.artifactId,
	p: fx.projectId,
	t: "artifact",
	u: null,
	l: null,
	...over,
})
