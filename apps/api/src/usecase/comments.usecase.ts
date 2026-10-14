import { RefusalError } from "@exagram/core/utils/refusal"

import type { CommentsDatagateway } from "@exagram/core/datagateway/comments.datagateway"
import type { User } from "@exagram/core/entity/auth"
import type { Comment } from "@exagram/core/entity/comment"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

/**
 * Both reads go through the `commentable` boundary: a Grant or a General Access row for a member of
 * the Artifact's own Workspace. A person 'anyone' admits from another Workspace reads the body and is
 * refused here exactly as if the Artifact did not exist.
 */
export class CommentsUsecase {
	constructor(
		private readonly comments: CommentsDatagateway,
		private readonly serve: ServeService,
	) {}

	/** Imported comments remain artifact-wide; their source revision is not exposed to pinned readers. */
	async list(
		user: Pick<User, "id" | "workspaceId">,
		artifactId: string,
		unlockHash?: string,
	): Promise<{ revisionId: string; items: Comment[] }> {
		return this.serve.serve(
			{
				principal: { kind: "user", id: user.id, workspaceId: user.workspaceId },
				surface: "web",
				action: "comments.list",
				artifactId,
				boundary: "commentable",
				unlockHash,
			},
			async (_tx, resolution) => {
				if (resolution.revisionId === null) throw new RefusalError()
				return { revisionId: resolution.revisionId, items: await this.comments.listByRevision(resolution.revisionId) }
			},
		)
	}

	/**
	 * The request names a Revision, not its Artifact, so the caller hands over a lookup of the unlock hash
	 * by Artifact id and this asks it once the Revision's Artifact is known.
	 */
	async create(
		user: Pick<User, "id" | "workspaceId">,
		revisionId: string,
		body: string,
		unlockHashOf?: (artifactId: string) => string | undefined,
	): Promise<Comment> {
		const artifactId = await this.comments.artifactOfRevision(revisionId)
		if (artifactId === null) throw new RefusalError()

		const id = await this.serve.serve(
			{
				principal: { kind: "user", id: user.id, workspaceId: user.workspaceId },
				surface: "web",
				action: "comments.create",
				artifactId,
				boundary: "commentable",
				unlockHash: unlockHashOf?.(artifactId),
			},
			async (_tx, resolution) => {
				// A reader may only write onto the Revision they were served — a pinned reader cannot
				// reach the newer one, and learning it exists is itself the leak.
				if (resolution.revisionId !== revisionId) throw new RefusalError()
				return this.comments.insert(revisionId, user.id, body)
			},
		)
		const comment = await this.comments.getById(id)
		if (comment === null) throw new RefusalError()
		return comment
	}
}
