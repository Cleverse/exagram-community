import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import { ConnectionFoldersSchema, ConnectionSchema, ListConnectionsQuerySchema } from "./types"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const connectionsContract = oc.prefix("/connections").router({
	list: base
		.route({ method: "GET", path: "/" })
		.input(z.object({ query: ListConnectionsQuerySchema }))
		.output(responseSchema(z.object({ connections: z.array(ConnectionSchema) }))),
	revoke: base
		.route({ method: "POST", path: "/{connectionId}/revoke" })
		.input(z.object({ params: z.object({ connectionId: z.uuid() }) }))
		.output(responseSchema(z.object({ id: z.uuid() }))),
	folders: base
		.route({ method: "GET", path: "/{connectionId}/folders" })
		.input(z.object({ params: z.object({ connectionId: z.uuid() }) }))
		.output(responseSchema(ConnectionFoldersSchema)),
	saveFolders: base
		.route({ method: "PUT", path: "/{connectionId}/folders" })
		.input(
			z.object({
				params: z.object({ connectionId: z.uuid() }),
				body: ConnectionFoldersSchema.omit({ projects: true }),
			}),
		)
		.output(responseSchema(ConnectionFoldersSchema)),
})
