export const askedAgo = (elapsedMs: number): string => {
	const minutes = Math.floor(elapsedMs / 60_000)
	if (minutes < 1) return "just now"
	if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`
	const days = Math.floor(hours / 24)
	return days === 1 ? "a day ago" : `${days} days ago`
}
