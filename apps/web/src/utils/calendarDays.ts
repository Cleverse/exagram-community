const DAY_MS = 86_400_000

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** Whole calendar days between two dates. Rounds, not floors: a DST day is 23h or 25h, not 24h. */
export const calendarDaysBetween = (value: Date | string, now: Date): number =>
	Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(value))) / DAY_MS))
