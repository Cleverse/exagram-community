import { z } from "zod"

export const GroupSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	memberCount: z.number().int(),
})

export const AdminGroupSchema = GroupSchema.extend({
	memberIds: z.array(z.uuid()),
})

export const GroupListSchema = z.discriminatedUnion("view", [
	z.object({ view: z.literal("admin"), items: z.array(AdminGroupSchema) }),
	z.object({ view: z.literal("member"), items: z.array(GroupSchema) }),
])

export const GroupBodySchema = z.object({
	name: z.string().trim().min(1).max(100),
	memberIds: z.array(z.uuid()).min(1).max(1000),
})
