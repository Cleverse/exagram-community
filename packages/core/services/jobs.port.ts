import { z } from "zod"

export const PARSE_QUEUE = "exagram.parse"
export const REDACT_QUEUE = "exagram.redact"

export const ParsePayloadSchema = z.object({ revisionId: z.uuid() })
export type ParsePayload = z.infer<typeof ParsePayloadSchema>

export const RedactPayloadSchema = z.object({ revisionId: z.uuid() })
export type RedactPayload = z.infer<typeof RedactPayloadSchema>

export interface JobQueue {
	/**
	 * At-least-once. The parse job must therefore be idempotent: a revision already
	 * `extraction_status = 'done'` is left alone.
	 */
	enqueueParse(revisionId: string): Promise<void>
	/**
	 * At-least-once, like the parse queue, and the handler is idempotent. Enqueueing is not part of
	 * the transaction that wrote the Revision, so a lost enqueue is caught by the sweeper, not lost.
	 */
	enqueueRedact(revisionId: string): Promise<void>
	/** The sweeper already reset and claimed the Revision, so this only sends the job. */
	enqueueClaimedRedact(revisionId: string): Promise<void>
}
