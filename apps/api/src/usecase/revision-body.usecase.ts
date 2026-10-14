import { getRevisionBodyRef } from "@exagram/core/repository/postgres/gen/exagram_usercontent_sql"
import { mintUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { User } from "@exagram/core/entity/auth"
import type { LedgeredPrincipal } from "@exagram/core/entity/principal"
import type { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

import { readableRevision } from "./revisions/readable-revision"

export interface MintedBody {
	revisionId: string
	url: string
	expiresInSeconds: number
}

export class RevisionBodyUsecase {
	constructor(
		private readonly serve: ServeService,
		private readonly secret: string,
		private readonly usercontentOrigin: string,
		private readonly ttlSeconds: number,
		private readonly revisions: Pick<RevisionsRepository, "getInArtifact">,
	) {}

	/**
	 * The token is minted only after the boundary named a Revision, and it names that Revision only. An
	 * anonymous reader's token carries the call id, as a Link page's does, so the iframe's fetch is on the
	 * record under the call that admitted them; a person's reads are already theirs by session.
	 * A reader whose row says download is off gets a token that carries it to the usercontent origin.
	 */
	async bodyToken(reader: LedgeredPrincipal, artifactId: string, unlockHash?: string): Promise<MintedBody> {
		const served = await this.serve.serve(
			{ principal: reader, surface: "web", action: "revisions.bodyToken", artifactId, unlockHash },
			async (tx, resolution, callId) => {
				if (resolution.revisionId === null) throw new RefusalError()
				const revision = await getRevisionBodyRef(tx, { revisionId: resolution.revisionId })
				if (revision === null) throw new RefusalError()
				await this.serve.recordBodyDigest(callId, revision.sha256)
				return { revisionId: resolution.revisionId, callId, noDownload: !resolution.download }
			},
		)
		return this.minted(served.revisionId, {
			callId: reader.kind === "anonymous" ? served.callId : undefined,
			noDownload: served.noDownload,
		})
	}

	/**
	 * One named Revision's body, so the Owner can read a Pending Revision before approving it. usercontent
	 * trusts the token entirely, so the entitlement is decided here, by `revisionText`'s rule
	 * (`readableRevision`). Anything else refuses like a stranger.
	 */
	async bodyTokenAt(
		user: Pick<User, "id" | "workspaceId">,
		artifactId: string,
		revisionId: string,
		unlockHash?: string,
	): Promise<MintedBody> {
		const served = await this.serve.serve(
			{
				principal: { kind: "user", id: user.id, workspaceId: user.workspaceId },
				surface: "web",
				action: "revisions.bodyTokenAt",
				artifactId,
				revisionId,
				unlockHash,
			},
			async (tx, visible, callId) => {
				const revision = await readableRevision(this.revisions, user.id, visible, revisionId)
				const ref = await getRevisionBodyRef(tx, { revisionId: revision.id })
				if (ref === null) throw new RefusalError()
				await this.serve.recordBodyDigest(callId, ref.sha256)
				return { revisionId: revision.id, noDownload: !visible.download }
			},
		)
		return this.minted(served.revisionId, { noDownload: served.noDownload })
	}

	private minted(revisionId: string, options: { callId?: string; noDownload: boolean }): MintedBody {
		const grant = { revisionId, callId: options.callId, ...(options.noDownload ? { noDownload: true as const } : {}) }
		return {
			revisionId,
			url: `${this.usercontentOrigin}/uc/${mintUsercontentToken(grant, this.secret, {
				ttlSeconds: this.ttlSeconds,
			})}`,
			expiresInSeconds: this.ttlSeconds,
		}
	}
}
