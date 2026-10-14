import { type coreContract } from "@exagram/core/contract"

import { type LiveEvent } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"

export class EventsRouter extends Router<typeof coreContract> {
	/**
	 * The caller's live feed over SSE. Each event is only a signal to refetch, and the first one on
	 * every stream is `resync`. Aborting `signal` closes the stream. A refused stream (429 over the
	 * cap) rejects with an `ApiError` carrying the status.
	 */
	async subscribe(signal: AbortSignal): Promise<AsyncIterable<LiveEvent>> {
		try {
			return await this.client.events.subscribe({}, { signal })
		} catch (error) {
			return failWith(error, "Could not open the live feed")
		}
	}
}
