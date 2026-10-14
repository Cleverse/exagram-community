import type { Access, LedgeredPrincipal, Principal, Surface } from "../../entity/principal"

export interface ResolvedRevision {
	artifactId: string
	revisionId: string
	kind: string
	access: Access
	text: string
	/** The ledger_calls row the resolution opened, for a caller that writes more serves. */
	callId: string
}

export interface ServeRead {
	principal: LedgeredPrincipal
	surface: Surface
	action: string
	artifactId: string
	/** The sha256 of the reader's unlock cookie for this Artifact. */
	unlockHash?: string
}

/**
 * Where the text comes from once the boundary has named a Revision. `packages/core` declares it;
 * `apps/api` implements it over the revisions gateway and the object store, because deciding
 * between `extracted_text` and the stored bytes is a usecase question, not a boundary one.
 */
export interface RevisionTextReader {
	readText(input: {
		principal: Principal
		artifactId: string
		revisionId: string
		/** Forwarded from the read, so the reader's own boundary lookup sees the same Unlock. */
		unlockHash?: string
	}): Promise<{ kind: string; mime: string; text: string } | null>
}

export interface ServePort {
	/**
	 * Resolves the revision the principal may read, writes `ledger_calls` plus a
	 * `ledger_serves` row inside one transaction, and returns null for both "no such
	 * artifact" and "withheld" — callers must not tell the two apart.
	 */
	resolveRevisionText(input: ServeRead): Promise<ResolvedRevision | null>
}
