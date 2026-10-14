const WINDOW_MS = 60_000
const MAX_TRACKED_KEYS = 10_000

export interface RateCounter {
	/** The budget this counter enforces, so a refusal can state it instead of repeating a literal. */
	readonly perMinute: number
	take(connectionId: string): boolean
}

/**
 * v1 debt: this Map lives in one process, so the budget is per-instance and resets on deploy.
 * A second API replica doubles the effective ceiling. Moving it to Postgres or Redis is week-1
 * work; the ledger already records every call, so the overage is visible either way.
 */
export function createRateCounter(perMinute: number): RateCounter {
	const windows = new Map<string, { startedAt: number; used: number }>()
	return {
		perMinute,
		take(connectionId) {
			const now = Date.now()
			const current = windows.get(connectionId)
			if (current && now - current.startedAt < WINDOW_MS) {
				if (current.used >= perMinute) return false
				current.used += 1
				return true
			}
			if (current) windows.delete(connectionId)
			if (windows.size >= MAX_TRACKED_KEYS) {
				for (const [key, window] of windows) {
					if (now - window.startedAt < WINDOW_MS) break
					windows.delete(key)
				}
			}
			if (windows.size >= MAX_TRACKED_KEYS) {
				const oldestKey = windows.keys().next().value
				if (oldestKey !== undefined) windows.delete(oldestKey)
			}
			windows.set(connectionId, { startedAt: now, used: 1 })
			return true
		},
	}
}
