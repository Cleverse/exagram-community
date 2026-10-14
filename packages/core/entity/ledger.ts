export interface LedgerEntry {
	callId: string
	principalKind: "user" | "connection" | "link" | "operator"
	principalId: string
	surface: "web" | "mcp" | "link" | "operator"
	action: string
	status: "authorized" | "delivered" | "failed"
	startedAt: Date
	deliveredAt: Date | null
	/** Null for a call that served no Artifact, so the Activity table shows the call with no link. */
	artifactId: string | null
	revisionId: string | null
	outcome: "served" | "withheld"
	reason: string | null
}

/** The person behind a call: the user themselves, or the owner of the connection that made it. */
export interface LedgerActor {
	userId: string
	name: string
	email: string
}

/** An Activity row names its actor; null for a share-link call, which no person makes. */
export interface ActivityEntry extends LedgerEntry {
	actor: LedgerActor | null
	/** The email a Workspace call acted on, such as an Invite's or a Reset Link's; null for other calls. */
	subject: string | null
}

export interface ActivityPage {
	items: ActivityEntry[]
	nextCursor: string | null
}

/** One person who has opened an Artifact, folded out of the Ledger's served body reads. */
export interface ArtifactViewer {
	userId: string
	name: string
	email: string
	firstOpenedAt: Date
	lastOpenedAt: Date
	count: number
}

export interface LedgerPage {
	items: LedgerEntry[]
	nextCursor: string | null
}
