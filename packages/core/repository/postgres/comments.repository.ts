import { PostgresRepository } from "./db"
import { getCommentById, getRevisionArtifact, insertComment, listCommentsByRevision } from "./gen/exagram_comments_sql"

import type { ListCommentsByRevisionRow } from "./gen/exagram_comments_sql"
import type { CommentsDatagateway } from "../../datagateway/comments.datagateway"
import type { Comment } from "../../entity/comment"
import type { Sql } from "postgres"

const toComment = (row: ListCommentsByRevisionRow): Comment => {
	if (row.revisionId === null) throw new Error("comment revision is missing")
	return {
		id: row.id,
		revisionId: row.revisionId,
		authorId: row.authorId,
		authorName: row.authorName,
		body: row.body,
		createdAt: row.createdAt,
	}
}

export class CommentsRepository extends PostgresRepository implements CommentsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async listByRevision(revisionId: string): Promise<Comment[]> {
		return (await listCommentsByRevision(this.sql, { revisionId })).map(toComment)
	}

	async insert(revisionId: string, authorId: string, body: string): Promise<string> {
		const row = await insertComment(this.sql, { revisionId, authorId, body })
		if (row === null) throw new Error("comment insert returned no row")
		return row.id
	}

	async getById(id: string): Promise<Comment | null> {
		const row = await getCommentById(this.sql, { id })
		return row === null ? null : toComment(row as ListCommentsByRevisionRow)
	}

	async artifactOfRevision(revisionId: string): Promise<string | null> {
		const row = await getRevisionArtifact(this.sql, { revisionId })
		return row?.artifactId ?? null
	}
}
