import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import { CommentSchema, CreateCommentBodySchema, ListCommentsQuerySchema } from "./type"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const commentsContract = oc.prefix("/comments").router({
	list: base
		.route({ method: "GET", path: "/" })
		.input(z.object({ query: ListCommentsQuerySchema }))
		.output(responseSchema(z.object({ revisionId: z.uuid(), items: z.array(CommentSchema) }))),

	create: base
		.route({ method: "POST", path: "/" })
		.input(z.object({ body: CreateCommentBodySchema }))
		.output(responseSchema(CommentSchema)),
})
