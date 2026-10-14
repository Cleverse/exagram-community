import { oc } from "@orpc/contract"
import { z } from "zod"

import { FinalizeBodySchema, UploadTicketSchema } from "../artifacts/types"
import { responseSchema } from "../interface"

import {
	BodyTokenSchema,
	PreviewTokenSchema,
	CreateRevisionTicketBodySchema,
	ListRevisionsResponseSchema,
	RevisionSchema,
	RevisionTextSchema,
} from "./types"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })
const artifactParams = z.object({ artifactId: z.uuid() })

export const revisionsContract = oc.router({
	list: base
		.route({ method: "GET", path: "/artifacts/{artifactId}/revisions" })
		.input(z.object({ params: artifactParams }))
		.output(responseSchema(ListRevisionsResponseSchema)),

	createUploadTicket: base
		.route({ method: "POST", path: "/artifacts/{artifactId}/revisions/ticket" })
		.input(z.object({ params: artifactParams, body: CreateRevisionTicketBodySchema }))
		.output(responseSchema(UploadTicketSchema)),

	finalize: base
		.route({ method: "POST", path: "/artifacts/{artifactId}/revisions/finalize" })
		.input(z.object({ params: artifactParams, body: FinalizeBodySchema }))
		.output(responseSchema(RevisionSchema)),

	restoreAsNew: base
		.route({ method: "POST", path: "/artifacts/{artifactId}/revisions/{revisionId}/restore" })
		.input(z.object({ params: artifactParams.extend({ revisionId: z.uuid() }) }))
		.output(responseSchema(RevisionSchema)),

	text: base
		.route({ method: "GET", path: "/artifacts/{artifactId}/text" })
		.input(z.object({ params: artifactParams }))
		.output(responseSchema(RevisionTextSchema)),

	revisionText: base
		.route({ method: "GET", path: "/artifacts/{artifactId}/revisions/{revisionId}/text" })
		.input(z.object({ params: artifactParams.extend({ revisionId: z.uuid() }) }))
		.output(responseSchema(RevisionTextSchema)),

	bodyToken: base
		.route({ method: "POST", path: "/{artifactId}/body-token" })
		.input(z.object({ params: z.object({ artifactId: z.uuid() }) }))
		.output(responseSchema(BodyTokenSchema)),

	bodyTokenAt: base
		.route({ method: "POST", path: "/{artifactId}/revisions/{revisionId}/body-token" })
		.input(z.object({ params: z.object({ artifactId: z.uuid(), revisionId: z.uuid() }) }))
		.output(responseSchema(BodyTokenSchema)),

	previewToken: base
		.route({ method: "POST", path: "/{artifactId}/preview-token" })
		.input(z.object({ params: z.object({ artifactId: z.uuid() }) }))
		.output(responseSchema(PreviewTokenSchema)),
})
