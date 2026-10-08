import { z } from "zod"

import { ArtifactKindSchema } from "../common"
import { FindingTypeSchema, RedactionStatusSchema } from "../redaction/types"

export const PendingRevisionSchema = z.object({
	revisionId: z.uuid(),
	artifactId: z.uuid(),
	seq: z.number().int().positive(),
	authorUserId: z.uuid(),
	authorConnectionId: z.uuid().nullable(),
	mime: z.string(),
	bytes: z.number().int().positive(),
	note: z.string().nullable(),
	createdAt: z.date(),
	title: z.string(),
	kind: ArtifactKindSchema,
	ownerId: z.uuid(),
	/**
	 * True when the caller approves this Revision (`exagram.artifact_owner`: the folder's owner, else the
	 * Artifact's). The list also carries the caller's own pending Revisions as Author, with false. Clients
	 * offer Approve and Discard from this, never from `ownerId`, which is not the Approver inside a folder.
	 */
	isApprover: z.boolean(),
	placeholderTypes: z.array(FindingTypeSchema),
	redactionStatus: RedactionStatusSchema,
	/** The author's display name (the person a Connection wrote for, when one did). */
	authorName: z.string(),
	/** The Connection's client name when a Connection wrote it. */
	authorConnectionName: z.string().nullable(),
})

export const ListPendingResponseSchema = z.object({ items: z.array(PendingRevisionSchema) })

export const ApprovalResultSchema = z.object({ revisionId: z.uuid() })
