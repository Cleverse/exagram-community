import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import {
	AccessRequestSchema,
	CancelAccessRequestBodySchema,
	CreateAccessRequestBodySchema,
	GrantAccessRequestBodySchema,
	GrantAccessRequestResultSchema,
} from "./type"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const accessRequestsContract = oc.prefix("/access-requests").router({
	/** Always `{ sent: true }`: never says whether the Artifact exists or the request was kept. */
	create: base
		.route({ method: "POST", path: "/" })
		.input(z.object({ body: CreateAccessRequestBodySchema }))
		.output(responseSchema(z.object({ sent: z.literal(true) }))),

	/**
	 * Withdraws the caller's open request on the Artifact, if there is one. Always `{ canceled: true }`, for
	 * any well-formed id, and counted against the same rate limit as `create`.
	 */
	cancel: base
		.route({ method: "POST", path: "/cancel" })
		.input(z.object({ body: CancelAccessRequestBodySchema }))
		.output(responseSchema(z.object({ canceled: z.literal(true) }))),

	/** Open Access Requests on Artifacts the caller owns. */
	list: base
		.route({ method: "GET", path: "/" })
		.output(responseSchema(z.object({ items: z.array(AccessRequestSchema) }))),

	grant: base
		.route({ method: "POST", path: "/{id}/grant" })
		.input(z.object({ params: z.object({ id: z.uuid() }), body: GrantAccessRequestBodySchema }))
		.output(responseSchema(GrantAccessRequestResultSchema)),

	dismiss: base
		.route({ method: "POST", path: "/{id}/dismiss" })
		.input(z.object({ params: z.object({ id: z.uuid() }) }))
		.output(responseSchema(z.object({ id: z.uuid() }))),
})
