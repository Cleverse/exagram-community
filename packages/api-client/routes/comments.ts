import { type coreContract } from "@exagram/core/contract"

import { type Comment, type CommentThread } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"
import { unwrapResult } from "../utils/result"

import { ARTIFACT_UNAVAILABLE } from "./artifacts"

export class CommentsRouter extends Router<typeof coreContract> {
	/**
	 * The answer names the Revision the reader resolved to, and the thread belongs to that Revision.
	 * Post back with that same id: a pinned reader comments on their Revision, not on the latest.
	 */
	async list(input: { artifactId: string }): Promise<CommentThread> {
		try {
			return unwrapResult(await this.client.comments.list({ query: input }))
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	async create(input: { revisionId: string; body: string }): Promise<Comment> {
		try {
			return unwrapResult(await this.client.comments.create({ body: input }))
		} catch (error) {
			return failWith(error, "Could not post the Comment")
		}
	}
}
