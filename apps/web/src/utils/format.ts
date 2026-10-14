const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

/** The contract types timestamps `Date`; JSON delivers strings. Both arrive here. */
export const formatWhen = (value: Date | string | null): string =>
	value === null ? "—" : WHEN.format(value instanceof Date ? value : new Date(value))

const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

/** A date with no clock time, for an expiry the Owner reads as "until this day". */
export const formatDay = (value: Date | string): string => DAY.format(value instanceof Date ? value : new Date(value))

/** Compact age like "3d" / "2w", for dense table columns; `formatWhen` remains the exact form. */
export const formatAge = (value: Date | string): string => {
	const date = value instanceof Date ? value : new Date(value)
	const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
	// Day zero is "0d", as the prototype writes it for a project created this session (line 1688).
	if (days < 7) return `${days}d`
	if (days < 30) return `${Math.floor(days / 7)}w`
	return `${Math.floor(days / 30)}mo`
}

export const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
