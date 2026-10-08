import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import { ApproveConsentBodySchema, ConsentInfoSchema, ConsentRedirectSchema } from "./types"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })
const uidParams = z.object({ uid: z.string().min(1).max(100) })

/**
 * These three sit under `/oauth/consent/{uid}` and not under `/v1` for one reason: oidc-provider
 * scopes the interaction cookie to exactly that path, and without the cookie there is no
 * interaction to finish. They are a separate contract so the `/v1` handler never serves them.
 */
export const consentContract = oc.prefix("/oauth/consent").router({
	info: base
		.route({ method: "GET", path: "/{uid}/info" })
		.input(z.object({ params: uidParams }))
		.output(responseSchema(ConsentInfoSchema)),
	approve: base
		.route({ method: "POST", path: "/{uid}/approve" })
		.input(z.object({ params: uidParams, body: ApproveConsentBodySchema }))
		.output(responseSchema(ConsentRedirectSchema)),
	deny: base
		.route({ method: "POST", path: "/{uid}/deny" })
		.input(z.object({ params: uidParams }))
		.output(responseSchema(ConsentRedirectSchema)),
})
