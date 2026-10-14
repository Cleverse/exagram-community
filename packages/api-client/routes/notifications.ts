import { type coreContract } from "@exagram/core/contract"

import { type NotificationList, type NotificationPreferences } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"
import { unwrapResult } from "../utils/result"

export class NotificationsRouter extends Router<typeof coreContract> {
	/**
	 * What is new for the caller since `since`, metadata only. Without `since` the answer has no items, just
	 * the server's clock, so a new device starts from now. A full page carries `next`; pass it back as `after` to read on.
	 */
	async list(input: { since?: Date; after?: string } = {}): Promise<NotificationList> {
		try {
			return unwrapResult(await this.client.notifications.list({ query: { since: input.since, after: input.after } }))
		} catch (error) {
			return failWith(error, "Could not load notifications")
		}
	}

	async getPreferences(): Promise<NotificationPreferences> {
		try {
			return unwrapResult(await this.client.notifications.getPreferences({}))
		} catch (error) {
			return failWith(error, "Could not load notification settings")
		}
	}

	/** Replaces the whole object. Muted folders the caller cannot see are dropped; the answer is what was kept. */
	async setPreferences(preferences: NotificationPreferences): Promise<NotificationPreferences> {
		try {
			return unwrapResult(await this.client.notifications.setPreferences({ body: preferences }))
		} catch (error) {
			return failWith(error, "Could not save notification settings")
		}
	}
}
