import { calendarDaysBetween } from "@/utils/calendarDays"

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "today" / "yesterday" / "3d ago" / "Sep 11" — the design's `ACTIVITY` helper, in calendar days. */
export const activityWhen = (value: Date | string, now: Date = new Date()): string => {
	const date = value instanceof Date ? value : new Date(value)
	const days = calendarDaysBetween(date, now)
	if (days === 0) return "today"
	if (days === 1) return "yesterday"
	if (days < 7) return `${days}d ago`
	return `${MONTH[date.getMonth()]} ${date.getDate()}`
}

/**
 * The row's LAST ACTIVITY cell. The design writes "Viewed" for someone else's file, but nothing
 * records views, so a file the reader does not own says "Updated" instead.
 */
export const lastActivity = ({
	updatedAt,
	ownerId,
	meId,
	now = new Date(),
}: {
	updatedAt: Date | string
	ownerId: string
	meId: string | undefined
	now?: Date
}): string => `${meId !== undefined && ownerId === meId ? "Edited" : "Updated"} ${activityWhen(updatedAt, now)}`
