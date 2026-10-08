import type { AccessRequest, AccessRequestResolution, OwnedAccessRequest } from "../entity/access-request"
import type { GrantRole } from "../entity/grant"

export interface AccessRequestsDatagateway {
	/**
	 * Keeps the request only when the requester could be granted the Artifact (ADR 0035); writes nothing
	 * otherwise and says nothing about which happened.
	 */
	open(input: { requesterId: string; artifactId: string; note: string | null; role: GrantRole }): Promise<void>
	/** Deletes the requester's own open request on the Artifact, if any; says nothing about which happened. */
	cancel(input: { requesterId: string; artifactId: string }): Promise<void>
	listOpenForOwner(ownerId: string, workspaceId: string): Promise<AccessRequest[]>
	/** One open request on an Artifact the caller owns, locked until commit; null for anything else. */
	getOpenForOwner(id: string, ownerId: string): Promise<OwnedAccessRequest | null>
	resolve(id: string, resolution: AccessRequestResolution): Promise<boolean>
}
