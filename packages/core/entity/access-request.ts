import type { GrantRole } from "./grant"

/** An open Access Request on an Artifact, as its Owner sees it. */
export interface AccessRequest {
	id: string
	artifactId: string
	artifactTitle: string
	requesterId: string
	requesterEmail: string
	requesterName: string
	note: string | null
	/** The role asked for; the Owner's grant defaults to it and may change it (ADR 0040). */
	role: GrantRole
	createdAt: Date
}

/** The parts of an open request the Owner acts on. */
export interface OwnedAccessRequest {
	id: string
	artifactId: string
	requesterId: string
	requesterEmail: string
}

export type AccessRequestResolution = "granted" | "dismissed"
