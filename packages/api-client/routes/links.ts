import { type coreContract } from "@exagram/core/contract"

import { type CreatedLink, type ShareLink } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"
import { unwrapResult } from "../utils/result"

import { ARTIFACT_UNAVAILABLE } from "./artifacts"

export class LinksRouter extends Router<typeof coreContract> {
	/**
	 * A Link always pins one approved Revision and always expires. The URL comes back
	 * once, here: the list never returns the token again, so a lost URL is made again, not recovered.
	 */
	async create(input: {
		artifactId: string
		revisionId: string
		expiresAt: string
		maxViews?: number
	}): Promise<CreatedLink> {
		try {
			return unwrapResult(await this.client.links.create({ body: input }))
		} catch (error) {
			return failWith(error, "Could not create the Link")
		}
	}

	/** Owner only. */
	async list(input: { artifactId: string }): Promise<ShareLink[]> {
		try {
			return unwrapResult(await this.client.links.list({ query: input })).items
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	async revoke(input: { linkId: string }): Promise<{ id: string }> {
		try {
			return unwrapResult(await this.client.links.revoke({ params: { id: input.linkId } }))
		} catch (error) {
			return failWith(error, "Could not revoke the Link")
		}
	}
}
