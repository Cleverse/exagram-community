import { type LiveEvent } from "@exagram/api-client"
import { type Query, type QueryKey } from "@tanstack/react-query"

/**
 * One invalidation. `idle` keys hold one named Revision's body (text, body and preview tokens): a key with
 * that Revision's id never needs a refetch while someone reads it, and refetching it would put the new
 * Current Revision's body under the old id, which swaps it under the reader. So only the cached copies
 * nobody has on screen are marked stale; a new Current Revision arrives under its own key.
 */
export type LiveInvalidation = { queryKey: QueryKey; idle?: true }

export type LivePlan = {
	/** One Artifact's keys, invalidated as the event arrives. */
	now: LiveInvalidation[]
	/**
	 * Keys shared across Artifacts (the Library's lists, the approvals inbox, every Artifact's key on an event
	 * naming none): debounced, so an approve-all or a bulk upload refetches each once.
	 */
	debounced: LiveInvalidation[]
}

/** Prefixes: each key carries its filter or id after these segments. */
const ARTIFACTS_LIST: QueryKey = ["artifacts", "list"]
const ARTIFACTS_SEARCH: QueryKey = ["artifacts", "search"]
const PROJECTS_LIST: QueryKey = ["projects", "list"]
const APPROVALS_PENDING: QueryKey = ["approvals", "pending"]
const REDACTED_TEXT: QueryKey = ["redaction", "redactedText"]
/**
 * The redaction settings a Project change can move by inheritance: every Project's, every Artifact's and the
 * workspace's (`QueryKeys.redaction` less `redactedText`, which is one Revision's body and changes only through
 * its own `redaction` event).
 */
const REDACTION_SETTINGS: QueryKey[] = [
	["redaction", "project"],
	["redaction", "artifact"],
	["redaction", "workspace"],
]
const GRANTS_ACCESS: QueryKey = ["grants", "access"]
const GRANTS_FOR_PROJECT: QueryKey = ["grants", "listForProject"]
const ACCESS_REQUESTS_LIST: QueryKey = ["accessRequests", "list"]
const ME: QueryKey = ["auth", "me"]
const WORKSPACE_ADMIN: QueryKey = ["workspace"]
const NOTIFICATION_PREFERENCES: QueryKey = ["notifications", "preferences"]
const ACTIVITY_WINDOW: QueryKey = ["ledger", "activityWindow"]

const BODY_READS = ["text", "bodyToken", "previewToken"] as const

/**
 * Which query keys a live event invalidates, by topic: an Artifact's own keys at once, keys shared across Artifacts
 * debounced.
 */
export const planFor = ({ topic, artifactId }: Pick<LiveEvent, "topic" | "artifactId">): LivePlan => {
	const now: LiveInvalidation[] = []
	const debounced: LiveInvalidation[] = []
	/** A key shared across Artifacts. */
	const shared = (...keys: QueryKey[]) => {
		for (const queryKey of keys) debounced.push({ queryKey })
	}
	/** One Artifact's key, or every Artifact's (then shared) when the event names none. */
	const own = (prefix: readonly string[], idle?: true) => {
		const entry: LiveInvalidation = { queryKey: artifactId === null ? prefix : [...prefix, artifactId] }
		if (idle) entry.idle = true
		if (artifactId === null) debounced.push(entry)
		else now.push(entry)
	}
	const bodies = () => {
		for (const read of BODY_READS) own(["revisions", read], true)
	}

	switch (topic) {
		case "current":
			own(["artifacts", "get"])
			own(["revisions", "list"])
			bodies()
			shared(ARTIFACTS_LIST)
			break
		case "revisions":
			// Also fires when a Revision's text extraction moves, which clears a row's "Indexing" mark.
			own(["artifacts", "get"])
			own(["revisions", "list"])
			shared(APPROVALS_PENDING, ARTIFACTS_LIST)
			break
		case "artifact":
			// Covers a change of the Artifact's own redaction setting or of the Project it inherits one from.
			own(["artifacts", "get"])
			own(["redaction", "artifact"])
			shared(ARTIFACTS_LIST, ARTIFACTS_SEARCH)
			break
		case "removed":
			own(["artifacts", "get"])
			shared(ARTIFACTS_LIST, ARTIFACTS_SEARCH)
			break
		case "reach":
			// The Grant may be the Artifact's or its Project's; `grants.access` is keyed by either, and the event
			// names no Project.
			own(["artifacts", "get"])
			own(["grants", "list"])
			shared(GRANTS_ACCESS, GRANTS_FOR_PROJECT, ARTIFACTS_LIST, ARTIFACTS_SEARCH, PROJECTS_LIST)
			break
		case "project":
			// The event names no Project, and a Project's redaction setting reaches its sub-Projects and Artifacts.
			shared(PROJECTS_LIST, ARTIFACTS_LIST, ...REDACTION_SETTINGS)
			break
		case "redaction":
			own(["redaction", "artifact"])
			shared(REDACTED_TEXT, APPROVALS_PENDING)
			break
		case "comments":
			own(["comments", "list"])
			break
		case "accessRequests":
			// Sent to the Owner only; one list holds the requests on every file they own.
			shared(ACCESS_REQUESTS_LIST)
			break
		case "resync":
			// Anything may have changed while the stream was down: every live key, every Artifact.
			shared(["artifacts", "get"], ["revisions", "list"])
			for (const read of BODY_READS) debounced.push({ queryKey: ["revisions", read], idle: true })
			shared(
				APPROVALS_PENDING,
				GRANTS_ACCESS,
				["grants", "list"],
				GRANTS_FOR_PROJECT,
				["redaction", "artifact"],
				REDACTED_TEXT,
				["comments", "list"],
				ACCESS_REQUESTS_LIST,
				ARTIFACTS_LIST,
				ARTIFACTS_SEARCH,
				PROJECTS_LIST,
				ME,
				WORKSPACE_ADMIN,
				NOTIFICATION_PREFERENCES,
				ACTIVITY_WINDOW,
			)
			break
		case "ping":
			// The server's heartbeat: it only proves the stream is alive.
			break
		case "webDeployed":
			// A new web build, not a data change: `WebDeployedListener` asks the update prompt to check.
			break
	}
	return { now, debounced }
}

/** `idle` keys skip the queries someone has on screen; see `LiveInvalidation`. */
export const idleOnly = (query: Query): boolean => !query.isActive()
