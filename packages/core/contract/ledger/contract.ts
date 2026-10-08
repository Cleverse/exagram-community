import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import { ActivityPageSchema, ArtifactViewerSchema, LedgerPageQuerySchema, LedgerPageSchema } from "./type"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const ledgerContract = oc.prefix("/ledger").router({
	forArtifact: base
		.route({ method: "GET", path: "/artifacts/{artifactId}" })
		.input(z.object({ params: z.object({ artifactId: z.uuid() }), query: LedgerPageQuerySchema }))
		.output(responseSchema(LedgerPageSchema)),

	viewers: base
		.route({ method: "GET", path: "/artifacts/{artifactId}/viewers" })
		.input(z.object({ params: z.object({ artifactId: z.uuid() }) }))
		.output(responseSchema(z.object({ items: z.array(ArtifactViewerSchema) }))),

	activity: base
		.route({ method: "GET", path: "/activity" })
		.input(z.object({ query: LedgerPageQuerySchema }))
		.output(responseSchema(ActivityPageSchema)),
})
