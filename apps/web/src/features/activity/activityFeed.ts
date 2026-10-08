import { type PendingRevision, type VisibleArtifact } from "@exagram/api-client"

import { clientLook } from "@/features/connections/clientMeta"
import { calendarDaysBetween } from "@/utils/calendarDays"
import { initialsOf } from "@/utils/initials"

/** Mine is what the viewer did (or a Connection did for them); Team is everything they can see. */
export type FeedScope = "mine" | "team"

export type FeedEvent = {
	key: string
	/** Epoch ms, for ordering and the day groups. */
	at: number
	artifactId: string
	/** "09:12", the event's local time of day. */
	time: string
	/** The file's title. */
	target: string
	/** What happened, in the mono tag after the title: "Published v3", "v4 needs approval". */
	tag: string
	/** A pending submission tints its tag marigold and leads it with a warning glyph. */
	pending: boolean
	/** The second line: who else sees it, or what clients read meanwhile. */
	detail: string
	/** The Source column: "You", a first name, or a client's name. */
	who: string
	/** Initials (or a client's tag) for the 22px actor square. */
	actor: string
	mine: boolean
}

export type DayGroup = {
	/** `YYYY-MM-DD` of the local day, stable across renders for the collapse state. */
	key: string
	/** "Today", "Yesterday", or the date itself for anything older. */
	name: string
	/** The date beside "Today" / "Yesterday"; empty when `name` already is the date. */
	date: string
	events: FeedEvent[]
}

/** The prototype shows the 60 most recent events of the chosen scope (T:L4110). */
export const FEED_LIMIT = 60

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const pad = (value: number) => String(value).padStart(2, "0")
const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name

/** "Mon 14 Sep", as the prototype's `feedDayLabel` writes it. */
export const dayDate = (date: Date): string => `${WEEKDAY[date.getDay()]} ${date.getDate()} ${MONTH[date.getMonth()]}`

export const dayKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const timeOfDay = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`

/** "Today · Mon 14 Sep", "Yesterday · Sun 13 Sep", then just "Sat 12 Sep". */
export const dayLabel = (date: Date, now: Date): { name: string; date: string } => {
	const days = calendarDaysBetween(date, now)
	if (days === 0) return { name: "Today", date: dayDate(date) }
	if (days === 1) return { name: "Yesterday", date: dayDate(date) }
	return { name: dayDate(date), date: "" }
}

const peopleLabel = (count: number) => `${count} ${count === 1 ? "person" : "people"}`

/**
 * Who wrote a pending Revision, as the reader should see it: "You" for their own; for a Connection's write
 * the client's name when it is the reader's own Connection, else "<first name>'s <client>" ("Grace's
 * Claude Code"); otherwise the author's first name.
 */
export const pendingAuthor = (revision: PendingRevision, meId: string | null): string => {
	if (revision.authorConnectionId !== null) {
		const client = revision.authorConnectionName ?? "Connection"
		return revision.authorUserId === meId ? client : `${firstName(revision.authorName)}'s ${client}`
	}
	return revision.authorUserId === meId ? "You" : firstName(revision.authorName)
}

export type FeedInput = {
	artifacts: VisibleArtifact[]
	pending: PendingRevision[]
	meId: string | null
	/** The viewer's initials, for their own actor square. */
	meInitials: string
}

/**
 * The Activity feed (T:L4097–4110), built in the browser from what the reader can already see: each
 * Artifact's latest publish and each pending submission that reaches them. Client reads are not here —
 * the Ledger's workspace view is admin-only and lives in Settings → Audit. Newest first and uncapped:
 * `feedFor` filters by scope and then caps, so a full Team feed never crowds out the reader's own events.
 *
 * A publish event is the Owner's: the library row carries no Revision author, and publishing (approving,
 * or an upload that publishes on arrival) is the Owner's act. So a publish is "Published vN" by the Owner,
 * and for publish events Mine means "published by me". A pending event is its author's.
 */
export const buildFeed = ({ artifacts, pending, meId, meInitials }: FeedInput): FeedEvent[] => {
	const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
	const events: FeedEvent[] = []

	for (const artifact of artifacts) {
		// Nothing approved yet: the pending submission below is the event, not a publish.
		if (artifact.revisionSeq === null || artifact.visibleRevisionId === null) continue
		const mine = artifact.ownerId === meId
		const shared = artifact.sharedWithNames.length
		const at = new Date(artifact.updatedAt)
		events.push({
			key: `artifact:${artifact.id}`,
			at: at.getTime(),
			artifactId: artifact.id,
			time: timeOfDay(at),
			target: artifact.title,
			tag: `Published v${artifact.revisionSeq}`,
			pending: false,
			detail: shared > 0 ? `Shared with ${peopleLabel(shared)}` : mine ? "Only you" : "Shared with you",
			who: mine ? "You" : firstName(artifact.ownerName),
			actor: mine ? meInitials : initialsOf(artifact.ownerName, undefined),
			mine,
		})
	}

	for (const revision of pending) {
		const current = artifactById.get(revision.artifactId)
		const at = new Date(revision.createdAt)
		const who = pendingAuthor(revision, meId)
		events.push({
			key: `pending:${revision.revisionId}`,
			at: at.getTime(),
			artifactId: revision.artifactId,
			time: timeOfDay(at),
			target: revision.title,
			tag: `v${revision.seq} needs approval`,
			pending: true,
			detail:
				current === undefined || current.revisionSeq === null
					? "Not published yet"
					: `Clients still read v${current.revisionSeq}`,
			who,
			actor:
				revision.authorConnectionId !== null
					? clientLook(revision.authorConnectionName ?? "Connection").initials
					: revision.authorUserId === meId
						? meInitials
						: initialsOf(revision.authorName, undefined),
			// A Connection writes on its person's behalf, so their Connection's submissions are theirs too.
			mine: revision.authorUserId === meId,
		})
	}

	return events.sort((a, b) => b.at - a.at)
}

/** One scope of the feed: its newest `FEED_LIMIT` events, and how many it holds before the cap. */
export const feedFor = (events: FeedEvent[], scope: FeedScope): { events: FeedEvent[]; total: number } => {
	const scoped = scope === "mine" ? events.filter((event) => event.mine) : events
	return { events: scoped.slice(0, FEED_LIMIT), total: scoped.length }
}

/** Buckets events by local calendar day, newest day first, keeping their order inside each day. */
export const groupByDay = (events: FeedEvent[], now: Date): DayGroup[] => {
	const groups: DayGroup[] = []
	for (const event of events) {
		const date = new Date(event.at)
		const key = dayKey(date)
		const last = groups[groups.length - 1]
		if (last?.key === key) last.events.push(event)
		else groups.push({ key, ...dayLabel(date, now), events: [event] })
	}
	return groups
}
