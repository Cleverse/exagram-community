import { z } from "zod"

import { GrantRoleSchema, GrantSchema } from "../grants/type"

export const ACCESS_REQUEST_NOTE_MAX = 500

/** Sent from the refusal screen. The answer is the same whether the Artifact exists or the request was kept. */
export const CreateAccessRequestBodySchema = z.object({
	artifactId: z.uuid(),
	note: z.string().trim().max(ACCESS_REQUEST_NOTE_MAX).optional(),
	/** The role asked for. Defaults to view. */
	role: GrantRoleSchema.optional(),
})

/** Sent from the Request access screen. The answer is the same whether a request was open. */
export const CancelAccessRequestBodySchema = z.object({ artifactId: z.uuid() })

/** An open Access Request on an Artifact the caller owns. */
export const AccessRequestSchema = z.object({
	id: z.uuid(),
	artifactId: z.uuid(),
	artifactTitle: z.string(),
	requesterId: z.uuid(),
	requesterEmail: z.email(),
	requesterName: z.string(),
	note: z.string().nullable(),
	/** The role asked for; a client's grant defaults to it. */
	role: GrantRoleSchema,
	createdAt: z.date(),
})

/** `role` is the Owner's choice; clients default it to the request's role. */
export const GrantAccessRequestBodySchema = z.object({ role: GrantRoleSchema })

export const GrantAccessRequestResultSchema = z.object({ id: z.uuid(), grant: GrantSchema })

export type AccessRequestView = z.infer<typeof AccessRequestSchema>
