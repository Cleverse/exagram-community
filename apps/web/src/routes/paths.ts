export const SETTINGS_TABS = ["general", "team", "security", "audit", "notifications"] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const paths = {
	signIn: "/signin",
	signUp: "/signup",
	/** A Join Link from an Admin's Invite. */
	join: (token: string) => `/join/${token}`,
	domainJoin: (id: string) => `/join/domain/${id}`,
	joinPending: "/join/pending",
	joinDeclined: "/join/declined",
	joinOffer: "/join/offer",
	/** A Reset Link an Admin or the server operator made. */
	reset: (token: string) => `/reset/${token}`,
	/** An email's unsubscribe link, `?token=…`; needs no session. */
	unsubscribe: "/unsubscribe",
	/** A confirmation email's link, `?token=…`; needs the session of the member it was sent for. */
	confirmEmail: "/confirm-email",
	library: "/",
	sharedWithMe: "/shared",
	mine: "/mine",
	/** The member's feed and the Revisions awaiting them. */
	activity: "/activity",
	context: "/context",
	/** The Context page on week `n` back, 0 being this week. */
	contextWeek: (week: number) => (week === 0 ? "/context" : `/context?week=${week}`),
	connections: "/connections",
	settings: (tab: SettingsTab) => `/settings/${tab}`,
	/** Every top-level Project the reader reaches; Back from a top-level Project lands here. */
	projects: "/projects",
	project: (projectId: string) => `/projects/${projectId}`,
	/**
	 * An Artifact's own page: the file in full view. It is the address a share or a copied link carries;
	 * a list shows the same file beside itself as `?preview=<id>` instead.
	 */
	artifact: (artifactId: string) => `/artifacts/${artifactId}`,
	consent: (uid: string) => `/oauth/consent/${uid}`,
} as const

/** `?preview=<id>` opens that Artifact in the content window beside a list (library, Project, Activity). */
export const PREVIEW_PARAM = "preview"

/**
 * Below this window width a click opens the full page rather than the preview: the list and the content
 * window need about this much side by side (Dropbox makes the same call).
 */
export const PREVIEW_MIN_VIEWPORT = 1280

/** A list page with an Artifact previewed beside it, keeping the page's other query parameters. */
export const withPreview = (pathname: string, search: string, artifactId: string | null): string => {
	const query = new URLSearchParams(search)
	if (artifactId === null) query.delete(PREVIEW_PARAM)
	else query.set(PREVIEW_PARAM, artifactId)
	const rest = query.toString()
	return rest === "" ? pathname : `${pathname}?${rest}`
}

/** The previewed id in a list page's query string, or `null`. */
export const previewIdOf = (search: string): string | null => new URLSearchParams(search).get(PREVIEW_PARAM)

/**
 * The addresses a preview used to have: `/…/artifacts/<id>` appended to a list path, with `?view=full`
 * or the older `?expanded=1` for full view. Returns where each now lives, or `null` for a path that was
 * never one of them.
 */
export const legacyPreviewTarget = (pathname: string, search: string): string | null => {
	const match = /^(\/shared|\/mine|\/activity|\/pending|\/projects\/[^/]+)\/artifacts\/([^/]+)\/?$/.exec(pathname)
	if (!match) return null
	const [, list = "", artifactId = ""] = match
	const query = new URLSearchParams(search)
	const full = query.get("view") === "full" || query.get("expanded") === "1"
	query.delete("view")
	query.delete("expanded")
	if (full) {
		// The page still reads the rest of the query (`panel=history`), so only the full-view flag goes.
		const rest = query.toString()
		return rest === "" ? paths.artifact(artifactId) : `${paths.artifact(artifactId)}?${rest}`
	}
	return withPreview(list === "/pending" ? paths.activity : list, query.toString(), artifactId)
}

const PROJECT_PATH = /^\/projects\/([^/]+)\/?$/

/** The Project a list path shows; `null` off a Project page. */
export const projectIdOf = (pathname: string): string | null => PROJECT_PATH.exec(pathname)?.[1] ?? null
