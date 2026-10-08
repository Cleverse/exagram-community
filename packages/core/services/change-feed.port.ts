import { z } from "zod"

import { type LiveEvent } from "../contract/events/type"

/** The Postgres channel migration 000022's triggers notify on. */
export const CHANGE_CHANNEL = "exagram_changes"

/**
 * What a trigger sends with `pg_notify`. Short keys keep the payload far under Postgres's 8000-byte cap.
 * `u` names the users to reach directly (a delete or lost Grant, when `reaches_artifact` is already false
 * after commit); `l` names the Links a change ends. Both are null when the feed must work the audience out.
 */
export const ChangeNoticeSchema = z.object({
	w: z.uuid(),
	a: z.uuid().nullable(),
	p: z.uuid().nullable(),
	t: z.enum([
		"current",
		"revisions",
		"artifact",
		"removed",
		"reach",
		"project",
		"redaction",
		"comments",
		"accessRequests",
		"link",
		"resync",
	]),
	u: z.array(z.uuid()).nullable(),
	l: z.array(z.uuid()).nullable(),
})
export type ChangeNotice = z.infer<typeof ChangeNoticeSchema>

/**
 * Sent on the same channel by the api's deploy hook, not by a trigger. A web deploy belongs to no workspace, so
 * it reaches every open stream; sharing the channel keeps it on the one LISTEN and its reconnect handling.
 */
export const WebDeployedNoticeSchema = z.object({ t: z.literal("webDeployed") })
export const WEB_DEPLOYED_NOTICE = JSON.stringify({ t: "webDeployed" } satisfies z.infer<
	typeof WebDeployedNoticeSchema
>)

export const SessionSwitchedNoticeSchema = z.object({
	t: z.literal("sessionSwitched"),
	s: z.uuid(),
	w: z.uuid(),
})

export interface ChangeFeed {
	subscribeUser(
		input: { userId: string; sessionId: string; workspaceId: string },
		onEvent: (event: LiveEvent) => void,
	): () => void
	/**
	 * `onGone` fires once when the Link stops being servable (revoked, or its Artifact removed); expiry is the
	 * caller's timer. `onReset` fires after a LISTEN reconnect, when a revoke may have been missed: the caller
	 * ends the stream plainly so the page reconnects and the route checks the Link again.
	 */
	subscribeLink(linkId: string, handlers: { onGone: () => void; onReset: () => void }): () => void
	isListening(): boolean
	quietMs(input: { userId: string; workspaceId: string }): number
	close(): Promise<void>
}

export interface ChangeFeedDeps {
	/** Wraps postgres.js `sql.listen`; `onListen` runs on the first connect and on every reconnect. */
	listen(
		channel: string,
		onNotify: (payload: string) => void,
		onListen: () => void,
	): Promise<{ unlisten: () => Promise<void> }>
	audience(artifactId: string, workspaceId: string): Promise<{ userId: string; member: boolean }[]>
}
