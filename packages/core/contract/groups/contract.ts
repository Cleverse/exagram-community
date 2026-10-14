import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import { AdminGroupSchema, GroupBodySchema, GroupListSchema } from "./types"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

/** A Team's Groups. Every Member lists them; only Admins write. A Personal Workspace has none. */
export const groupsContract = oc.router({
	list: base.route({ method: "GET", path: "/groups" }).input(z.object({})).output(responseSchema(GroupListSchema)),

	create: base
		.route({ method: "POST", path: "/groups" })
		.input(z.object({ body: GroupBodySchema }))
		.output(responseSchema(AdminGroupSchema)),

	update: base
		.route({ method: "PUT", path: "/groups/{id}" })
		.input(z.object({ params: z.object({ id: z.uuid() }), body: GroupBodySchema }))
		.output(responseSchema(AdminGroupSchema)),

	delete: base
		.route({ method: "DELETE", path: "/groups/{id}" })
		.input(z.object({ params: z.object({ id: z.uuid() }) }))
		.output(responseSchema(z.object({ id: z.uuid() }))),
})
