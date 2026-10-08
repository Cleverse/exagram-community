import { z } from "zod"

import { ExtractionStatusSchema, RevisionStatusSchema, UPLOAD_MAX_BYTES } from "../common"

export const RevisionSourceProvenanceSchema = z.object({
	parentRevisionId: z.uuid().nullable(),
	restoredFrom: z.uuid().nullable(),
	snippet: z.string().nullable(),
	origin: z.string().nullable(),
	clientId: z.uuid().nullable(),
	storagePath: z.string().nullable(),
	aiEdit: z
		.object({
			model: z.string().nullable(),
			instruction: z.string().nullable(),
			scoped: z.boolean().nullable(),
			createdAt: z.date().nullable(),
		})
		.nullable(),
})

export const RevisionSchema = z.object({
	id: z.uuid(),
	artifactId: z.uuid(),
	seq: z.number().int().positive(),
	status: RevisionStatusSchema,
	authorUserId: z.uuid(),
	authorConnectionId: z.uuid().nullable(),
	storageKey: z.string(),
	mime: z.string(),
	bytes: z.number().int().positive(),
	sha256: z.string(),
	note: z.string().nullable(),
	extractedText: z.string().nullable(),
	extractionStatus: ExtractionStatusSchema,
	createdAt: z.date(),
	approvedAt: z.date().nullable(),
	sourceProvenance: RevisionSourceProvenanceSchema.nullable().optional(),
})

export const ListRevisionsResponseSchema = z.object({ items: z.array(RevisionSchema) })

export const CreateRevisionTicketBodySchema = z.object({
	mime: z.string().min(1).max(255),
	bytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
})

export const RevisionTextSchema = z.object({
	revisionId: z.uuid(),
	mime: z.string(),
	text: z.string(),
})

export const BodyTokenSchema = z.object({
	revisionId: z.uuid(),
	url: z.url(),
	expiresInSeconds: z.number().int(),
})

export const PreviewTokenSchema = z.object({
	revisionId: z.uuid(),
	url: z.url().nullable(),
	expiresInSeconds: z.number().int(),
})
