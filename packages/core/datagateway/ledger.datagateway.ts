import type { ActivityEntry, ArtifactViewer, LedgerEntry } from "../entity/ledger"
import type { PrincipalKind, ServeOutcome, Surface, WithheldReason } from "../entity/principal"

export interface StartCallParams {
	principalKind: PrincipalKind
	principalId: string
	surface: Surface
	action: string
	/** Whom an Admin action on the Workspace acted on: for an Invite, the invited email. */
	subject?: string | null
	workspaceId?: string | null
}

export interface RecordServeParams {
	callId: string
	/** Null when the call served no Artifact at all — `project_list` is the only such tool today. */
	artifactId: string | null
	revisionId?: string | null
	outcome: ServeOutcome
	reason?: WithheldReason | null
	form: "original" | "redacted" | null
	detectorVersion: number | null
}

/**
 * Where a Ledger page stops: the last serve row it returned. Both lists are one row per serve, so
 * paging on the call alone would drop the rest of a call that served many Artifacts.
 */
export interface LedgerCursor {
	/** The call's started_at as microsecond UTC ISO text; a Date would truncate it to milliseconds. */
	startedAt: string
	callId: string
	serveId: string
}

export interface LedgerRow<T extends LedgerEntry> {
	entry: T
	cursor: LedgerCursor
}

export interface LedgerDatagateway {
	startCall(params: StartCallParams): Promise<string>
	recordServe(params: RecordServeParams): Promise<void>
	markDelivered(callId: string, bodySha256?: string | null): Promise<void>
	markFailed(callId: string): Promise<void>
	setBodyDigest(callId: string, bodySha256: string): Promise<void>
	listForArtifact(artifactId: string, limit: number, cursor: LedgerCursor | null): Promise<LedgerRow<LedgerEntry>[]>
	listActivity(workspaceId: string, limit: number, cursor: LedgerCursor | null): Promise<LedgerRow<ActivityEntry>[]>
	/** Every person but the Owner served a body read of the Artifact, most recent first. */
	listArtifactViewers(artifactId: string): Promise<ArtifactViewer[]>
}
