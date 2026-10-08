/**
 * `operator` is the server command that prints a Reset Link (ADR 0034): a Ledger principal only, whose
 * id is the account it acted on. The visibility functions return nothing for it, so it never reads.
 * `anonymous` is a signed-out reader of an Artifact open to anyone with the link (ADR 0042); its id is
 * that Artifact, the only thing the reader presented, and `visible_artifact` is the only function that
 * answers it.
 */
export type PrincipalKind = "user" | "connection" | "link" | "operator" | "anonymous"
export type Surface = "web" | "mcp" | "link" | "operator"
export type Access = "owner" | "edit" | "collaborate" | "view"
export type ServeOutcome = "served" | "withheld"
export type CallStatus = "authorized" | "delivered" | "failed"

/**
 * Why a serve was withheld. `out-of-boundary` covers "not visible to this principal" and "no such
 * id" in one word on purpose: telling those apart is what REFUSAL_TEXT exists to prevent, so the
 * Ledger records no distinction the reader was never shown. `password-required` and `expired` are the two
 * exceptions, because those readers were told (ADR 0044).
 */
export type WithheldReason =
	| "out-of-boundary"
	| "outside-connection-folders"
	| "no-approved-revision"
	| "not-owner"
	| "refused-in-serve"
	| "link-exhausted"
	| "redaction-unavailable"
	| "password-required"
	| "expired"
	| "incorrect-password"
	/** A fixable upload problem (wrong size, checksum, missing object): nothing was served, and the call stays in Audit. */
	| "upload-problem"

export interface Principal {
	kind: PrincipalKind
	id: string
}

/** A person's call in the Workspace their session acts in, or the one the action is in. */
export interface UserInWorkspace {
	kind: "user"
	id: string
	workspaceId: string
}

/** A person's call that has no Workspace to name, so the database places it by the account. */
export interface UnplacedUser {
	kind: "user"
	id: string
	unplaced: true
}

export type LedgeredPrincipal = UserInWorkspace | UnplacedUser | { kind: Exclude<PrincipalKind, "user">; id: string }

/** The reader a signed-out open of `artifactId` is ledgered and judged as (ADR 0042). */
export const anonymousReader = (artifactId: string): LedgeredPrincipal => ({ kind: "anonymous", id: artifactId })
