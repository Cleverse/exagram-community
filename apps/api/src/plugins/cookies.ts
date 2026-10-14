/** One cookie's value from a request's `Cookie` header, or undefined when it is not there. */
export const readCookie = (header: string | string[] | undefined, name: string): string | undefined => {
	const raw = Array.isArray(header) ? header.join("; ") : (header ?? "")
	for (const part of raw.split(";")) {
		const [key, ...rest] = part.trim().split("=")
		if (key === name) return rest.join("=")
	}
	return undefined
}
