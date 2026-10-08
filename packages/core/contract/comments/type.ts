import { z } from "zod"

export const CommentSchema = z.object({
	id: z.uuid(),
	revisionId: z.uuid(),
	authorId: z.uuid(),
	authorName: z.string(),
	body: z.string(),
	createdAt: z.date(),
})

export const ListCommentsQuerySchema = z.object({ artifactId: z.uuid() })
export const CreateCommentBodySchema = z.object({
	revisionId: z.uuid(),
	body: z.string().min(1).max(10_000),
})
