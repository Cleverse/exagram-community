import { z } from "zod"

import { LinkPreviewSchema, PublishPolicySchema } from "../common"

export const ProjectSchema = z.object({
	id: z.uuid(),
	workspaceId: z.uuid(),
	ownerId: z.uuid(),
	parentProjectId: z.uuid().nullable(),
	name: z.string(),
	publishPolicy: PublishPolicySchema,
	linkPreview: LinkPreviewSchema,
	sourceDescription: z.string().nullable().optional(),
	createdAt: z.date(),
})

export const SetProjectPublishPolicyBodySchema = z.object({ publishPolicy: PublishPolicySchema })

export const SetProjectLinkPreviewBodySchema = z.object({ linkPreview: LinkPreviewSchema })

/**
 * The list names the Owner to every reader, and everyone else who reaches the Project to those who may invite;
 * `memberNames` is null for a Viewer.
 */
export const VisibleProjectSchema = ProjectSchema.extend({
	ownerName: z.string(),
	memberNames: z.array(z.string()).nullable(),
})

export const ListProjectsResponseSchema = z.object({ items: z.array(VisibleProjectSchema) })

export const CreateProjectBodySchema = z.object({
	name: z.string().min(1).max(200),
	parentProjectId: z.uuid().nullable().default(null),
})

export const RenameProjectBodySchema = z.object({ name: z.string().min(1).max(200) })

export const MoveProjectBodySchema = z.object({ parentProjectId: z.uuid().nullable() })

export const DeletedProjectSchema = z.object({ id: z.uuid() })
