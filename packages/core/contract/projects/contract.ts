import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import {
	CreateProjectBodySchema,
	DeletedProjectSchema,
	ListProjectsResponseSchema,
	MoveProjectBodySchema,
	ProjectSchema,
	RenameProjectBodySchema,
	SetProjectLinkPreviewBodySchema,
	SetProjectPublishPolicyBodySchema,
} from "./types"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })
const idParams = z.object({ id: z.uuid() })

export const projectsContract = oc.router({
	list: base
		.route({ method: "GET", path: "/projects" })
		.input(z.object({}))
		.output(responseSchema(ListProjectsResponseSchema)),

	create: base
		.route({ method: "POST", path: "/projects" })
		.input(z.object({ body: CreateProjectBodySchema }))
		.output(responseSchema(ProjectSchema)),

	rename: base
		.route({ method: "POST", path: "/projects/{id}/rename" })
		.input(z.object({ params: idParams, body: RenameProjectBodySchema }))
		.output(responseSchema(ProjectSchema)),

	move: base
		.route({ method: "POST", path: "/projects/{id}/move" })
		.input(z.object({ params: idParams, body: MoveProjectBodySchema }))
		.output(responseSchema(ProjectSchema)),

	setPublishPolicy: base
		.route({ method: "PATCH", path: "/projects/{id}/publish-policy" })
		.input(z.object({ params: idParams, body: SetProjectPublishPolicyBodySchema }))
		.output(responseSchema(ProjectSchema)),

	setLinkPreview: base
		.route({ method: "PATCH", path: "/projects/{id}/link-preview" })
		.input(z.object({ params: idParams, body: SetProjectLinkPreviewBodySchema }))
		.output(responseSchema(ProjectSchema)),

	delete: base
		.route({ method: "DELETE", path: "/projects/{id}" })
		.input(z.object({ params: idParams }))
		.output(responseSchema(DeletedProjectSchema)),
})
