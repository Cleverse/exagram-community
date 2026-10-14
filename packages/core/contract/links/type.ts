import { z } from "zod"

export const LinkSchema = z.object({
	id: z.uuid(),
	artifactId: z.uuid(),
	revisionId: z.uuid(),
	expiresAt: z.date(),
	maxViews: z.number().int().nullable(),
	viewsUsed: z.number().int(),
	revokedAt: z.date().nullable(),
	createdAt: z.date(),
})

export const CreateLinkBodySchema = z.object({
	artifactId: z.uuid(),
	revisionId: z.uuid(),
	expiresAt: z.iso.datetime().refine((value) => {
		const at = Date.parse(value)
		return at > Date.now() && at <= Date.now() + 90 * 86_400_000
	}, "expiresAt must be in the future and at most 90 days out"),
	maxViews: z.number().int().min(1).max(10_000).optional(),
})

/** The token is in this shape once and never again; only its sha256 is stored. */
export const CreatedLinkSchema = LinkSchema.extend({ token: z.string(), url: z.url() })

export const ListLinksQuerySchema = z.object({ artifactId: z.uuid() })
