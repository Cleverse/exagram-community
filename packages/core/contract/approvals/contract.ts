import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import { ApprovalResultSchema, ListPendingResponseSchema } from "./types"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })
const revisionParams = z.object({ revisionId: z.uuid() })

export const approvalsContract = oc.router({
	listPending: base
		.route({ method: "GET", path: "/approvals/pending" })
		.input(z.object({}))
		.output(responseSchema(ListPendingResponseSchema)),

	approve: base
		.route({ method: "POST", path: "/approvals/{revisionId}/approve" })
		.input(
			z.object({
				params: revisionParams,
				body: z.object({ confirmPlaceholders: z.boolean().default(false) }).default({ confirmPlaceholders: false }),
			}),
		)
		.output(responseSchema(ApprovalResultSchema)),

	discard: base
		.route({ method: "POST", path: "/approvals/{revisionId}/discard" })
		.input(z.object({ params: revisionParams }))
		.output(responseSchema(ApprovalResultSchema)),
})
