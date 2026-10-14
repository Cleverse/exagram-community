import { type Notification, type Timestamp } from "@exagram/api-client"

import { type MacNotice } from "@/features/notifications/macBridge"

/*
 * What a device posts from `GET /v1/notifications`. The iPhone app implements these same rules in Swift;
 * change both together.
 */

/** Each call asks this far behind the cursor, so an item committed just before it is not missed. */
export const OVERLAP_MS = 120_000
/** How many already-posted keys a device remembers, to drop what the overlap returns again. */
export const SEEN_MAX = 200
/** More new items than this at once become one summary. */
export const SUMMARY_OVER = 3

/** A device asks for at most this many pages in one check (`next` → `after`), 50 items each. */
export const MAX_PAGES = 5

/**
 * A device's cursor for one server, member and Workspace: the newest `createdAt` seen, the last keys it has had, and
 * `floor`, the server's clock at its first run: nothing created at or before it is ever posted. State saved before
 * `floor` existed has none, and then nothing is held back.
 */
export type NotifierState = { cursor: string; seen: string[]; floor?: string }

export const stateKey = (server: string, userId: string, workspaceId: string): string =>
	`exagram.notifications.${server}.${userId}.${workspaceId}`

const timeOf = (value: Timestamp): number => new Date(value).getTime()

export const loadState = (storage: Pick<Storage, "getItem">, key: string): NotifierState | null => {
	try {
		const raw = storage.getItem(key)
		if (raw === null) return null
		const parsed = JSON.parse(raw) as Partial<NotifierState> | null
		if (
			typeof parsed?.cursor !== "string" ||
			!Number.isFinite(timeOf(parsed.cursor)) ||
			!Array.isArray(parsed.seen) ||
			!parsed.seen.every((key) => typeof key === "string")
		) {
			return null
		}
		// A missing or unreadable floor means none, as in state saved before it existed.
		const floor =
			typeof parsed.floor === "string" && Number.isFinite(timeOf(parsed.floor)) ? { floor: parsed.floor } : {}
		return { cursor: parsed.cursor, seen: parsed.seen, ...floor }
	} catch {
		return null
	}
}

export const saveState = (storage: Pick<Storage, "setItem">, key: string, state: NotifierState): void => {
	try {
		storage.setItem(key, JSON.stringify(state))
	} catch {
		// Storage can be off (private mode, blocked site data); the next call then starts over from the server's clock.
	}
}

/** A device with no state yet starts from the server's clock, posts nothing, and never posts anything older. */
export const firstState = (serverTime: Timestamp): NotifierState => {
	const now = new Date(serverTime).toISOString()
	return { cursor: now, seen: [], floor: now }
}

export const sinceFor = (state: NotifierState): Date => new Date(timeOf(state.cursor) - OVERLAP_MS)

export const keyOf = (item: Pick<Notification, "kind" | "id">): string => `${item.kind}:${item.id}`

/** Who did it, and what. `actorName` is null only for a grant whose sharer the caller may not see. */
export const bodyFor = (item: Notification): string => {
	const actor = item.actorName
	switch (item.kind) {
		case "accessRequest":
			return actor === null ? "Someone asked for access" : `${actor} asked for access`
		case "pendingRevision":
			return actor === null ? "A revision is waiting for your approval" : `${actor} sent a revision for your approval`
		case "grant":
			if (item.artifactId === null) {
				return actor === null ? "A folder was shared with you" : `${actor} shared this folder with you`
			}
			return actor === null ? "Shared with you" : `${actor} shared this with you`
		case "comment":
			return actor === null ? "New comment" : `${actor} commented`
		default:
			// Not in KNOWN_KINDS, so never posted.
			return "New activity"
	}
}

/** The screen a clicked notification opens: one the Mac app's `NotificationPath` accepts. */
export const pathFor = (item: Notification): string => {
	switch (item.kind) {
		case "accessRequest":
		case "pendingRevision":
			return "/activity"
		case "grant":
			if (item.artifactId !== null) return `/artifacts/${item.artifactId}`
			return item.projectId !== null ? `/projects/${item.projectId}` : "/activity"
		case "comment":
			return item.artifactId !== null ? `/artifacts/${item.artifactId}` : "/activity"
		default:
			return "/activity"
	}
}

export const noticeFor = (item: Notification): MacNotice => ({
	id: keyOf(item),
	title: item.title,
	body: bodyFor(item),
	path: pathFor(item),
})

/** The kinds this build can word and route. A newer server may send others; they are remembered, never posted. */
const KNOWN_KINDS: ReadonlySet<string> = new Set<Notification["kind"]>([
	"accessRequest",
	"pendingRevision",
	"grant",
	"comment",
])

/**
 * Takes every page one check fetched, combined. Drops what this device already has in `seen`, moves the cursor to
 * the newest `createdAt` returned (never back), and remembers every new key. A new key is posted only if its kind is
 * known and it is newer than the device's `floor` (its first run); the rest are remembered without being posted or
 * counted. More than `SUMMARY_OVER` posts become one summary pointing at Activity.
 */
export const planNotifications = (
	state: NotifierState,
	items: readonly Notification[],
): { state: NotifierState; notices: MacNotice[] } => {
	const seen = new Set(state.seen)
	const added: string[] = []
	const fresh: Notification[] = []
	const floor = state.floor === undefined ? -Infinity : timeOf(state.floor)
	let cursor = timeOf(state.cursor)
	for (const item of items) {
		const at = timeOf(item.createdAt)
		if (Number.isFinite(at) && at > cursor) cursor = at
		const key = keyOf(item)
		if (seen.has(key)) continue
		seen.add(key)
		added.push(key)
		if (KNOWN_KINDS.has(item.kind) && !(at <= floor)) fresh.push(item)
	}
	const next: NotifierState = {
		cursor: new Date(cursor).toISOString(),
		seen: [...state.seen, ...added].slice(-SEEN_MAX),
		...(state.floor === undefined ? {} : { floor: state.floor }),
	}
	const notices =
		fresh.length > SUMMARY_OVER
			? [
					{
						id: `summary:${next.cursor}`,
						title: "Exagram",
						body: `${fresh.length} new items in Activity`,
						path: "/activity",
					},
				]
			: fresh.map(noticeFor)
	return { state: next, notices }
}
