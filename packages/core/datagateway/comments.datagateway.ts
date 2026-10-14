import type { Comment } from "../entity/comment"

export interface CommentsDatagateway {
	listByRevision(revisionId: string): Promise<Comment[]>
	insert(revisionId: string, authorId: string, body: string): Promise<string>
	getById(id: string): Promise<Comment | null>
	artifactOfRevision(revisionId: string): Promise<string | null>
}
