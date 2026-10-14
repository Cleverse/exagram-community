/** First letters of the first two words, uppercase; the local part of the email otherwise. */
export const initialsOf = (name: string | undefined, email: string | undefined): string => {
	const words = (name ?? "").trim().split(/\s+/).filter(Boolean)
	if (words.length > 0) {
		return words
			.slice(0, 2)
			.map((word) => word[0])
			.join("")
			.toUpperCase()
	}
	return (email ?? "?").slice(0, 2).toUpperCase()
}
