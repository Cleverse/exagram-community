import { type coreContract } from "@exagram/core/contract"

import { type AccessRequest, type Grant, type GrantRole } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"
import { unwrapResult } from "../utils/result"

export { ACCESS_REQUEST_NOTE_MAX } from "@exagram/core/contract/access-requests/type"

export class AccessRequestsRouter extends Router<typeof coreContract> {
	/**
	 * Always `{ sent: true }`: the answer never says whether the Artifact exists or the request was kept. `role` is the
	 * role asked for, view when left out.
	 */
	async create(input: { artifactId: string; note?: string; role?: GrantRole }): Promise<{ sent: true }> {
		try {
			return unwrapResult(await this.client.accessRequests.create({ body: input }))
		} catch (error) {
			return failWith(error, "Could not send the request")
		}
	}

	/** Withdraws the caller's open request on the Artifact, if any. Always `{ canceled: true }`. */
	async cancel(input: { artifactId: string }): Promise<{ canceled: true }> {
		try {
			return unwrapResult(await this.client.accessRequests.cancel({ body: input }))
		} catch (error) {
			return failWith(error, "Could not cancel the request")
		}
	}

	/** Open requests on Artifacts the caller owns. */
	async list(): Promise<AccessRequest[]> {
		try {
			return unwrapResult(await this.client.accessRequests.list({})).items
		} catch (error) {
			return failWith(error, "Could not load access requests")
		}
	}

	/**
	 * Creates an ordinary Grant for the requester through the same rules as inviting them. Pass the request's own `role`
	 * unless the Owner chose another.
	 */
	async grant(input: { id: string; role: GrantRole }): Promise<{ id: string; grant: Grant }> {
		try {
			return unwrapResult(
				await this.client.accessRequests.grant({ params: { id: input.id }, body: { role: input.role } }),
			)
		} catch (error) {
			return failWith(error, "Could not grant access")
		}
	}

	/** Decline, in the UI: the requester hears a decline that names neither the file nor its Owner. */
	async dismiss(input: { id: string }): Promise<{ id: string }> {
		try {
			return unwrapResult(await this.client.accessRequests.dismiss({ params: { id: input.id } }))
		} catch (error) {
			return failWith(error, "Could not dismiss the request")
		}
	}
}
