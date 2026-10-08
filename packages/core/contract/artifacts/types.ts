import { z } from "zod"

import {
	AccessSchema,
	ArtifactKindSchema,
	ArtifactScopeSchema,
	DefaultPinSchema,
	ExtractionStatusSchema,
	PublishPolicySchema,
	UPLOAD_MAX_BYTES,
} from "../common"

/** Restricted (Grants only), everyone on the Workspace's Allowed Domain, or anyone with the link (ADR 0027, 0042). */
export const GeneralAccessSchema = z.enum(["restricted", "org", "anyone"])

export const ArtifactSchema = z.object({
	id: z.uuid(),
	workspaceId: z.uuid(),
	ownerId: z.uuid(),
	projectId: z.uuid().nullable(),
	kind: ArtifactKindSchema,
	title: z.string(),
	sourceFilename: z.string().nullable().optional(),
	sourceDescription: z.string().nullable().optional(),
	currentRevisionId: z.uuid().nullable(),
	defaultPin: DefaultPinSchema,
	publishPolicy: PublishPolicySchema.nullable(),
	generalAccess: GeneralAccessSchema,
	deletedAt: z.date().nullable(),
	createdAt: z.date(),
})

/**
 * What the Owner chose for Anyone with the link (ADR 0044). `passwordSet` says a password is stored; the
 * password and its hash never leave the server.
 */
export const AnyoneSettingsSchema = z.object({
	passwordOn: z.boolean(),
	passwordSet: z.boolean(),
	expiresAt: z.date().nullable(),
	download: z.boolean(),
})

/**
 * `currentRevisionId` is present only for an owner: a pinned grantee learning that a newer Revision
 * exists is the leak the pin prevents. `isPinned` is the server's answer, never a client-side
 * comparison of two ids.
 */
export const VisibleArtifactSchema = ArtifactSchema.omit({ currentRevisionId: true }).extend({
	workspaceName: z.string(),
	orgDomain: z.string().nullable(),
	currentRevisionId: z.uuid().nullable().optional(),
	visibleRevisionId: z.uuid().nullable(),
	access: AccessSchema,
	effectivePublishPolicy: PublishPolicySchema,
	isPinned: z.boolean(),
	revisionSeq: z.number().int().nullable(),
	/** The visible Revision's text extraction (`queued` while indexing); absent from servers that predate it. */
	extractionStatus: ExtractionStatusSchema.nullable().optional(),
	updatedAt: z.date(),
	ownerName: z.string(),
	sharedCount: z.number().int().nonnegative(),
	sharedWithNames: z.array(z.string()),
	/** False only for a reader Anyone with the link admits while its Owner withheld download. */
	canDownload: z.boolean(),
	/** The Owner's alone; null for every other reader. */
	anyoneSettings: AnyoneSettingsSchema.nullable(),
})

export const ListArtifactsQuerySchema = z.object({
	scope: ArtifactScopeSchema.default("all"),
	kind: ArtifactKindSchema.optional(),
	projectId: z.uuid().optional(),
})

export const ListArtifactsResponseSchema = z.object({ items: z.array(VisibleArtifactSchema) })

export const UploadTicketSchema = z.object({
	artifactId: z.uuid(),
	storageKey: z.string(),
	url: z.url(),
	expiresInSeconds: z.number().int().positive(),
	requiredHeaders: z.record(z.string(), z.string()),
})

export const CreateArtifactBodySchema = z.object({
	kind: ArtifactKindSchema,
	title: z.string().min(1).max(500),
	projectId: z.uuid().nullable().default(null),
	mime: z.string().min(1).max(255),
	bytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
})

export const CreatedArtifactSchema = z.object({ artifact: ArtifactSchema, ticket: UploadTicketSchema })

export const FinalizeBodySchema = z.object({
	storageKey: z.string().min(1).max(500),
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	/** §A.3 checks "sha256 and size": the ticket signed this size and finalize re-measures it. */
	bytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
	note: z.string().max(2000).nullable().default(null),
})

export const MoveArtifactBodySchema = z.object({ projectId: z.uuid().nullable() })

export const SetPublishPolicyBodySchema = z.object({ publishPolicy: PublishPolicySchema.nullable() })

export const SetGeneralAccessBodySchema = z.object({ generalAccess: GeneralAccessSchema })

export const ANYONE_PASSWORD_MIN = 8
export const ANYONE_PASSWORD_MAX = 128

/**
 * Every field is optional and an absent one stays as it is. `password` replaces the stored one;
 * `passwordOn: true` needs a stored password or this call's. `expiresInDays: null` removes the expiry.
 */
export const SetAnyoneSettingsBodySchema = z.object({
	passwordOn: z.boolean().optional(),
	password: z.string().min(ANYONE_PASSWORD_MIN).max(ANYONE_PASSWORD_MAX).optional(),
	expiresInDays: z
		.union([z.literal(1), z.literal(7), z.literal(30)])
		.nullable()
		.optional(),
	download: z.boolean().optional(),
})

export const UnlockBodySchema = z.object({ password: z.string().min(1).max(ANYONE_PASSWORD_MAX) })

export const UnlockResponseSchema = z.object({ unlocked: z.literal(true) })
