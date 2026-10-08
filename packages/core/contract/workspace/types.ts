import { z } from "zod"

export const InviteRoleSchema = z.enum(["admin", "member"])

/** Admin or not (ADR 0023 §1); the Workspace Owner is always an Admin. */
export const MemberRoleSchema = InviteRoleSchema

/** A Member as every Member of the Workspace sees them. */
export const MemberSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	email: z.string(),
	role: MemberRoleSchema,
	workspaceOwner: z.boolean(),
	joinedAt: z.date(),
})

/** What only an Admin sees beside each Member (ADR 0023 §4, §5). */
export const AdminMemberSchema = MemberSchema.extend({
	lastActiveAt: z.date().nullable(),
	projectCount: z.number().int(),
	connectionCount: z.number().int(),
})

/** The Team list. A Member's answer has no Admin-only field at all, not an empty one. */
export const MemberListSchema = z.discriminatedUnion("view", [
	z.object({ view: z.literal("admin"), items: z.array(AdminMemberSchema) }),
	z.object({ view: z.literal("member"), items: z.array(MemberSchema) }),
])

export const SetMemberRoleBodySchema = z.object({ role: MemberRoleSchema })

/** `transferTo` names the Member who takes over what the removed one owns; required when they own anything. */
export const RemoveMemberBodySchema = z.object({ transferTo: z.uuid().optional() })

/** An Invite as an Admin lists it. Never its token: the Join Link is shown once, when issued. */
export const WorkspaceInviteSchema = z.object({
	id: z.uuid(),
	email: z.string(),
	role: InviteRoleSchema,
	via: z.enum(["admin_invite", "member_invite"]),
	invitedByName: z.string(),
	createdAt: z.date(),
	expiresAt: z.date(),
})

export const CreateInviteBodySchema = z.object({
	email: z.email().max(320),
	role: InviteRoleSchema,
})

/**
 * A created or renewed Invite with its Join Link, `{web origin}/join/{token}`, and whether an email carrying it was
 * queued. `url` is null for a Member whose Invite was emailed: only the invited person gets that link (ADR 0041 §3).
 */
export const IssuedInviteSchema = z.object({
	invite: WorkspaceInviteSchema,
	url: z.string().nullable(),
	emailQueued: z.boolean(),
})

/**
 * An Admin's Invites, and whether they can create Reset Links here (ADMIN_PASSWORD_RESET is on and the
 * Workspace is a Team), so the Settings page shows that section beside Invites only when it would work.
 */
export const WorkspaceInvitesSchema = z.object({
	items: z.array(WorkspaceInviteSchema),
	passwordReset: z.boolean(),
})

export const CreateResetLinkBodySchema = z.object({
	email: z.email().max(320),
})

/** A Reset Link, `{web origin}/reset/{token}`, shown once; it works once, until `expiresAt`. */
export const IssuedResetLinkSchema = z.object({
	url: z.string(),
	expiresAt: z.date(),
})
