import type { Link, NewLink } from "../entity/link"
import type { Sql } from "postgres"

export interface ClaimedView {
	artifactId: string
	revisionId: string
	viewsUsed: number
	maxViews: number | null
}

export interface LinksDatagateway {
	/** Throws MemberRemovedError when the creator is Removed, including by a removal it waited on. */
	insert(link: NewLink): Promise<string>
	listByArtifact(artifactId: string): Promise<Link[]>
	getById(id: string): Promise<Link | null>
	findIdByTokenHash(tokenHash: string): Promise<string | null>
	revoke(id: string): Promise<boolean>
	/** Takes the transaction so the count moves in the same transaction as the ledger row. */
	claimView(tx: Sql, id: string): Promise<ClaimedView | null>
	revokeExpired(): Promise<number>
	/** The Artifact and Revision a Link points at, whatever its state — a withheld row still names them. */
	findTarget(id: string): Promise<{ artifactId: string; revisionId: string } | null>
	isExhausted(id: string): Promise<boolean>
	/**
	 * When a Link an open page may keep watching expires: not revoked, unexpired, its Artifact not deleted.
	 * `max_views` is ignored on purpose, since a page that already claimed its view stays open. A read
	 * only: it writes no Ledger row and claims no view.
	 */
	findWatchableExpiry(id: string): Promise<Date | null>
}
