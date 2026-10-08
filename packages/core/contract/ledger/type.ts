import { z } from "zod"

export const LedgerEntrySchema = z.object({
	callId: z.uuid(),
	principalKind: z.enum(["user", "connection", "link", "operator", "anonymous"]),
	principalId: z.uuid(),
	surface: z.enum(["web", "mcp", "link", "operator"]),
	action: z.string(),
	status: z.enum(["authorized", "delivered", "failed"]),
	startedAt: z.date(),
	deliveredAt: z.date().nullable(),
	artifactId: z.uuid().nullable(),
	revisionId: z.uuid().nullable(),
	outcome: z.enum(["served", "withheld"]),
	reason: z.string().nullable(),
})

export const ActivityEntrySchema = LedgerEntrySchema.extend({
	actor: z.object({ userId: z.uuid(), name: z.string(), email: z.email() }).nullable(),
	subject: z.string().nullable(),
})

export const ActivityPageSchema = z.object({
	items: z.array(ActivityEntrySchema),
	nextCursor: z.string().nullable(),
})

export const ArtifactViewerSchema = z.object({
	userId: z.uuid(),
	name: z.string(),
	email: z.email(),
	firstOpenedAt: z.date(),
	lastOpenedAt: z.date(),
	count: z.number().int(),
})

export const LedgerPageSchema = z.object({
	items: z.array(LedgerEntrySchema),
	nextCursor: z.string().nullable(),
})

export const LedgerPageQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().optional(),
})
