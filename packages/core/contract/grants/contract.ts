import { oc } from "@orpc/contract"
import { z } from "zod"

import { AccessSchema } from "../common"
import { responseSchema } from "../interface"

import {
	CreateGrantBodySchema,
	DefaultPinSchema,
	GrantSchema,
	GroupSuggestionSchema,
	InviteSuggestionSchema,
	ListGrantsQuerySchema,
	ListInviteSuggestionsQuerySchema,
	SetDefaultPinBodySchema,
	UpdateGrantPinBodySchema,
	UpdateGrantRoleBodySchema,
} from "./type"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const grantsContract = oc.prefix("/grants").router({
	list: base
		.route({ method: "GET", path: "/" })
		.input(z.object({ query: ListGrantsQuerySchema }))
		.output(responseSchema(z.object({ items: z.array(GrantSchema) }))),

	access: base
		.route({ method: "GET", path: "/access" })
		.input(z.object({ query: ListGrantsQuerySchema }))
		.output(responseSchema(z.object({ access: AccessSchema.nullable() }))),

	suggestions: base
		.route({ method: "GET", path: "/suggestions" })
		.input(z.object({ query: ListInviteSuggestionsQuerySchema }))
		.output(
			responseSchema(z.object({ items: z.array(InviteSuggestionSchema), groups: z.array(GroupSuggestionSchema) })),
		),

	create: base
		.route({ method: "POST", path: "/" })
		.input(z.object({ body: CreateGrantBodySchema }))
		.output(responseSchema(GrantSchema)),

	updateRole: base
		.route({ method: "PATCH", path: "/{id}/role" })
		.input(z.object({ params: z.object({ id: z.uuid() }), body: UpdateGrantRoleBodySchema }))
		.output(responseSchema(GrantSchema)),

	updatePin: base
		.route({ method: "PATCH", path: "/{id}/pin" })
		.input(z.object({ params: z.object({ id: z.uuid() }), body: UpdateGrantPinBodySchema }))
		.output(responseSchema(GrantSchema)),

	remove: base
		.route({ method: "DELETE", path: "/{id}" })
		.input(z.object({ params: z.object({ id: z.uuid() }) }))
		.output(responseSchema(z.object({ id: z.uuid() }))),

	setDefaultPin: base
		.route({ method: "PATCH", path: "/artifacts/{artifactId}/default-pin" })
		.input(z.object({ params: z.object({ artifactId: z.uuid() }), body: SetDefaultPinBodySchema }))
		.output(responseSchema(z.object({ artifactId: z.uuid(), defaultPin: DefaultPinSchema }))),
})
