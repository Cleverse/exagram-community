import { MemberRemovedError } from "../../utils/refusal"

import { PostgresRepository } from "./db"
import {
	claimLinkView,
	getLinkById,
	getLinkIdByTokenHash,
	getLinkTargetForLedger,
	getLinkWatchableExpiry,
	isLinkExhausted,
	insertLink,
	listLinksByArtifact,
	revokeExpiredLinks,
	revokeLink,
} from "./gen/exagram_links_sql"

import type { ListLinksByArtifactRow } from "./gen/exagram_links_sql"
import type { ClaimedView, LinksDatagateway } from "../../datagateway/links.datagateway"
import type { Link, NewLink } from "../../entity/link"
import type { Sql } from "postgres"

const toLink = (row: ListLinksByArtifactRow): Link => ({
	id: row.id,
	artifactId: row.artifactId,
	revisionId: row.revisionId,
	expiresAt: row.expiresAt,
	maxViews: row.maxViews,
	viewsUsed: row.viewsUsed,
	revokedAt: row.revokedAt,
	createdBy: row.createdBy,
	createdAt: row.createdAt,
})

export class LinksRepository extends PostgresRepository implements LinksDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async insert(link: NewLink): Promise<string> {
		const row = await insertLink(this.sql, {
			artifactId: link.artifactId,
			revisionId: link.revisionId,
			tokenHash: link.tokenHash,
			expiresAt: link.expiresAt,
			maxViews: link.maxViews,
			createdBy: link.createdBy,
		})
		if (row === null) throw new MemberRemovedError()
		return row.id
	}

	async listByArtifact(artifactId: string): Promise<Link[]> {
		return (await listLinksByArtifact(this.sql, { artifactId })).map(toLink)
	}

	async getById(id: string): Promise<Link | null> {
		const row = await getLinkById(this.sql, { id })
		return row === null ? null : toLink(row as ListLinksByArtifactRow)
	}

	async findIdByTokenHash(tokenHash: string): Promise<string | null> {
		const row = await getLinkIdByTokenHash(this.sql, { tokenHash })
		return row?.id ?? null
	}

	async revoke(id: string): Promise<boolean> {
		return (await revokeLink(this.sql, { id })) !== null
	}

	async claimView(tx: Sql, id: string): Promise<ClaimedView | null> {
		const row = await claimLinkView(tx, { id })
		return row === null
			? null
			: { artifactId: row.artifactId, revisionId: row.revisionId, viewsUsed: row.viewsUsed, maxViews: row.maxViews }
	}

	async revokeExpired(): Promise<number> {
		return (await revokeExpiredLinks(this.sql)).length
	}

	async findTarget(id: string): Promise<{ artifactId: string; revisionId: string } | null> {
		const row = await getLinkTargetForLedger(this.sql, { linkId: id })
		return row === null ? null : { artifactId: row.artifactId, revisionId: row.revisionId }
	}

	async isExhausted(id: string): Promise<boolean> {
		return (await isLinkExhausted(this.sql, { linkId: id }))?.exhausted === 1
	}

	// Not through visible_artifacts: that drops a Link once its last view is claimed, and the page that
	// claimed it must still hear when the Link goes.
	async findWatchableExpiry(id: string): Promise<Date | null> {
		return (await getLinkWatchableExpiry(this.sql, { linkId: id }))?.expiresAt ?? null
	}
}
