import { type consentContract, type coreContract } from "@exagram/core/contract"
import { type ContractRouterClient } from "@orpc/contract"

import { type Connection, type ConnectionFolders } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"
import { unwrapResult } from "../utils/result"

export type ConsentInfo = Awaited<ReturnType<ContractRouterClient<typeof consentContract>["info"]>>["result"]

export class ConnectionsRouter extends Router<typeof coreContract> {
	/**
	 * The consent procedures answer on a second link. oidc-provider scopes the interaction cookie to
	 * `/oauth/consent/<uid>`, so they cannot live under `/v1` at all (Task P6-19); they are reached
	 * from here because they are how a Connection comes into being.
	 */
	constructor(
		client: ContractRouterClient<typeof coreContract>,
		private readonly consent: ContractRouterClient<typeof consentContract>,
	) {
		super(client)
	}

	async list(): Promise<Connection[]> {
		try {
			return unwrapResult(await this.client.connections.list({})).connections
		} catch (error) {
			return failWith(error, "Could not load the Connections")
		}
	}

	/** Revoking the row also kills the oidc grant, so live access tokens stop working. */
	async revoke(input: { connectionId: string }): Promise<{ id: string }> {
		try {
			return unwrapResult(await this.client.connections.revoke({ params: input }))
		} catch (error) {
			return failWith(error, "Could not revoke the Connection")
		}
	}

	async folders(input: { connectionId: string }): Promise<ConnectionFolders> {
		try {
			return unwrapResult(await this.client.connections.folders({ params: input }))
		} catch (error) {
			return failWith(error, "Could not load the Connection's folders")
		}
	}

	async saveFolders(input: {
		connectionId: string
		access: "all" | "named"
		otherFilesAccess: "none" | "view"
		folders: ConnectionFolders["folders"]
	}): Promise<ConnectionFolders> {
		try {
			const { connectionId, ...body } = input
			return unwrapResult(await this.client.connections.saveFolders({ params: { connectionId }, body }))
		} catch (error) {
			return failWith(error, "Could not save the Connection's folders")
		}
	}

	async consentInfo(input: { uid: string }): Promise<ConsentInfo> {
		try {
			return unwrapResult(await this.consent.info({ params: input }))
		} catch (error) {
			return failWith(error, "This consent request is no longer valid")
		}
	}

	async approveConsent(input: { uid: string; name: string; scopes: string[] }): Promise<{ redirectTo: string }> {
		try {
			const { uid, ...body } = input
			return unwrapResult(await this.consent.approve({ params: { uid }, body }))
		} catch (error) {
			return failWith(error, "Could not approve this connection")
		}
	}

	async denyConsent(input: { uid: string }): Promise<{ redirectTo: string }> {
		try {
			return unwrapResult(await this.consent.deny({ params: input }))
		} catch (error) {
			return failWith(error, "Could not cancel this connection")
		}
	}
}
