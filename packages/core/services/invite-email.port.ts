import { z } from "zod"

/** What `InvitesUsecase` hands its mailer; the queue and the template that consume it are Notification Email's. */
export const InviteEmailPayloadSchema = z.object({
	inviteId: z.uuid(),
	tokenHash: z.string().min(1),
	messageId: z.string().min(1),
	to: z.email(),
	url: z.url(),
	workspaceName: z.string(),
	invitedByName: z.string(),
	role: z.enum(["admin", "member"]),
	expiresAt: z.iso.datetime(),
})
export type InviteEmailPayload = z.infer<typeof InviteEmailPayloadSchema>
