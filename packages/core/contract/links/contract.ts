import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import { CreateLinkBodySchema, CreatedLinkSchema, LinkSchema, ListLinksQuerySchema } from "./type"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const linksContract = oc.prefix("/links").router({
	create: base
		.route({ method: "POST", path: "/" })
		.input(z.object({ body: CreateLinkBodySchema }))
		.output(responseSchema(CreatedLinkSchema)),

	list: base
		.route({ method: "GET", path: "/" })
		.input(z.object({ query: ListLinksQuerySchema }))
		.output(responseSchema(z.object({ items: z.array(LinkSchema) }))),

	revoke: base
		.route({ method: "POST", path: "/{id}/revoke" })
		.input(z.object({ params: z.object({ id: z.uuid() }) }))
		.output(responseSchema(z.object({ id: z.uuid() }))),
})
