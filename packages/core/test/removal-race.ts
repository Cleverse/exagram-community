import type { Sql } from "postgres"

export type RaceOutcome<R, W> = { removed: R; written: { landed: W } | { error: string } }

/** Returns early once `settled` is true, so a write that never waits is seen landing rather than timing out. */
export async function untilLockWaits(sql: Sql, count: number, settled: () => boolean = () => false): Promise<void> {
	const lockWaits = async () =>
		(
			await sql<{ total: number }[]>`
				SELECT count(*)::int AS total FROM pg_stat_activity
				WHERE datname = current_database() AND wait_event_type = 'Lock'
			`
		)[0]!.total
	for (let tries = 0; !settled() && (await lockWaits()) < count; tries++) {
		if (tries > 200) throw new Error(`expected ${count} sessions waiting on a lock`)
		await new Promise((resolve) => setTimeout(resolve, 25))
	}
}

export async function raceRemoval<R, W>(
	sql: Sql,
	targetId: string,
	removal: () => Promise<R>,
	write: () => Promise<W>,
	/**
	 * Holds only the target's membership of this Workspace, the one the removal locks. A write that locks more of the
	 * target's memberships then queues behind the removal on that row; held on every row, it could take a row the
	 * removal does not need first and reach the shared one as the hold ends, ahead of the removal.
	 */
	heldWorkspaceId?: string,
): Promise<RaceOutcome<R, W>> {
	let releaseHold = () => {}
	const held = new Promise<void>((resolve) => (releaseHold = resolve))
	let holding = () => {}
	const holds = new Promise<void>((resolve) => (holding = resolve))
	const hold = sql.begin(async (tx) => {
		await tx`SELECT 1 FROM exagram.memberships WHERE user_id = ${targetId}
			AND (${heldWorkspaceId ?? null}::uuid IS NULL OR workspace_id = ${heldWorkspaceId ?? null}::uuid) FOR UPDATE`
		holding()
		await held
	})
	await holds

	const removed = removal()
	await untilLockWaits(sql, 1)
	const written = write().then(
		(landed) => ({ landed }),
		(error: unknown) => ({ error: (error as Error).constructor.name }),
	)
	await untilLockWaits(sql, 2)
	releaseHold()
	await hold
	return { removed: await removed, written: await written }
}
