import type { Sql } from "postgres"

export type RaceOutcome<R, W> = { removed: R; written: { landed: W } | { error: string } }

export async function untilLockWaits(sql: Sql, count: number): Promise<void> {
	const lockWaits = async () =>
		(
			await sql<{ total: number }[]>`
				SELECT count(*)::int AS total FROM pg_stat_activity
				WHERE datname = current_database() AND wait_event_type = 'Lock'
			`
		)[0]!.total
	for (let tries = 0; (await lockWaits()) < count; tries++) {
		if (tries > 200) throw new Error(`expected ${count} sessions waiting on a lock`)
		await new Promise((resolve) => setTimeout(resolve, 25))
	}
}

export async function raceRemoval<R, W>(
	sql: Sql,
	targetId: string,
	removal: () => Promise<R>,
	write: () => Promise<W>,
): Promise<RaceOutcome<R, W>> {
	let releaseHold = () => {}
	const held = new Promise<void>((resolve) => (releaseHold = resolve))
	let holding = () => {}
	const holds = new Promise<void>((resolve) => (holding = resolve))
	const hold = sql.begin(async (tx) => {
		await tx`SELECT 1 FROM exagram.memberships WHERE user_id = ${targetId} FOR UPDATE`
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
