import { formatAge } from "@/utils/format"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const pad = (value: number) => String(value).padStart(2, "0")

/** The prototype's sheet kicker date, "11 Sep 2026 · 09:12", not the locale form used elsewhere. */
export const formatSheetDate = (value: Date | string): string => {
	const date = value instanceof Date ? value : new Date(value)
	return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The compact age with "ago", "3d ago" / "2w ago"; day zero reads "today", not "0d ago". */
export const ageLabel = (value: Date | string): string => {
	const age = formatAge(value)
	return age === "0d" ? "today" : `${age} ago`
}

/**
 * The preview meta line's "edited …": minutes or hours inside the last day ("35m ago", "2h ago"),
 * the compact age after that ("3d ago", "1w ago"). A clock a little ahead of the server reads "1m ago".
 */
export const editedLabel = (value: Date | string): string => {
	const date = value instanceof Date ? value : new Date(value)
	const minutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60_000))
	if (minutes < 60) return `${minutes}m ago`
	if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`
	return `${formatAge(date)} ago`
}
