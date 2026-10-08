import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { MemberRemovedError, RefusalError } from "@exagram/core/utils/refusal"

import type { LinksDatagateway } from "@exagram/core/datagateway/links.datagateway"
import type { Link } from "@exagram/core/entity/link"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

export interface CreateLinkInput {
	artifactId: string
	revisionId: string
	expiresAt: string
	maxViews?: number
}

export type CreatedLink = Link & { token: string; url: string }

export class LinksUsecase {
	constructor(
		private readonly links: LinksDatagateway,
		private readonly serve: ServeService,
		private readonly linkOrigin: string,
	) {}

	private async assertOwner(userId: string, artifactId: string): Promise<void> {
		const resolution = await this.serve.resolveUnledgered({ kind: "user", id: userId }, artifactId)
		if (resolution === null || resolution.access !== "owner") throw new RefusalError()
	}

	async create(userId: string, input: CreateLinkInput): Promise<CreatedLink> {
		await this.assertOwner(userId, input.artifactId)
		const minted = mintLinkToken()
		let id: string
		try {
			// The links trigger refuses a revision that is pending or belongs to another artifact.
			id = await this.links.insert({
				artifactId: input.artifactId,
				revisionId: input.revisionId,
				tokenHash: minted.tokenHash,
				expiresAt: new Date(input.expiresAt),
				maxViews: input.maxViews ?? null,
				createdBy: userId,
			})
		} catch (error) {
			if (error instanceof MemberRemovedError) throw error
			throw new RefusalError()
		}
		const link = await this.links.getById(id)
		if (link === null) throw new RefusalError()
		return { ...link, token: minted.token, url: `${this.linkOrigin}/l/${minted.token}` }
	}

	async list(userId: string, artifactId: string): Promise<Link[]> {
		await this.assertOwner(userId, artifactId)
		return this.links.listByArtifact(artifactId)
	}

	async revoke(userId: string, id: string): Promise<string> {
		const link = await this.links.getById(id)
		if (link === null) throw new RefusalError()
		await this.assertOwner(userId, link.artifactId)
		await this.links.revoke(id)
		return id
	}
}
