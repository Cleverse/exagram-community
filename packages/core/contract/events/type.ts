import { z } from "zod"

/** What changed on an Artifact. A signal to refetch, never the content itself. */
export const LiveTopicSchema = z.enum([
	"current",
	"revisions",
	"artifact",
	"removed",
	"reach",
	"project",
	"redaction",
	"comments",
	/** An Access Request on an Artifact the reader owns was opened or closed. Sent to the Owner only. */
	"accessRequests",
	"resync",
	/** A data-level heartbeat, so a client can tell a half-open stream from a quiet one. */
	"ping",
	/** A new web build went live, so the tab checks its `version.json`. Every stream gets it; it names nothing. */
	"webDeployed",
])
export type LiveTopic = z.infer<typeof LiveTopicSchema>

export const LiveEventSchema = z.object({
	topic: LiveTopicSchema,
	/** Null for a workspace-wide signal. Carries no Project id: a fan-out must not name Projects the reader does not reach. */
	artifactId: z.uuid().nullable(),
	/**
	 * Only on a stream's opening `resync`: how long, in ms, the server has seen no change in the reader's
	 * workspace (0 when it cannot vouch, e.g. right after its LISTEN reconnected). A page that started loading
	 * after that quiet began already holds what the `resync` reports, and may skip it.
	 */
	quietMs: z.number().int().nonnegative().optional(),
})
export type LiveEvent = z.infer<typeof LiveEventSchema>
