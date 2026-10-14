/** The file paths a sign-in may land on; the API accepts the same two shapes as `returnTo`. */
export const SIGN_IN_FILE_PATH = /^\/(artifacts|projects)\/[0-9a-f-]{36}$/

/** What `AuthGuard` remembered: `to` for password sign-in, `file` for Google (the query only tells us `?invited=1`). */
export const readSignInFrom = (state: unknown) => {
	const from = typeof state === "object" && state !== null && "from" in state ? state.from : undefined
	if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//") || from.includes("\\")) return null
	const [path = "", query = ""] = from.split("?", 2)
	const match = SIGN_IN_FILE_PATH.exec(path)
	return {
		to: from,
		file: match ? { path, kind: match[1] === "projects" ? "a folder" : "a file" } : null,
		invited: new URLSearchParams(query).get("invited") === "1",
	}
}

export type SignInFrom = NonNullable<ReturnType<typeof readSignInFrom>>
