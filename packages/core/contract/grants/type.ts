import { z } from "zod"

export const GrantRoleSchema = z.enum(["view", "collaborate", "edit"])
export const DefaultPinSchema = z.enum(["latest", "current"])

/** Whom a Grant names: one person, or one Group whose live members it reaches. */
export const GranteeSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("person"),
		id: z.uuid(),
		email: z.email(),
		name: z.string(),
		/** Shown by email only: invited and not signed in yet, or a Guest who has opened nothing here yet. */
		pending: z.boolean(),
	}),
	z.object({ kind: z.literal("group"), id: z.uuid(), name: z.string(), memberCount: z.number().int() }),
])

/**
 * `grantee` says whom the Grant names. The flat fields repeat it for clients shipped before Groups, which decode
 * them: for a Group, its id and name, an empty email, and never pending.
 */
export const GrantSchema = z.object({
	id: z.uuid(),
	artifactId: z.uuid().nullable(),
	projectId: z.uuid().nullable(),
	grantee: GranteeSchema,
	granteeId: z.uuid(),
	granteeEmail: z.string(),
	granteeName: z.string(),
	granteePending: z.boolean(),
	role: GrantRoleSchema,
	pinnedRevisionId: z.uuid().nullable(),
	createdAt: z.date(),
})

export const ListGrantsQuerySchema = z
	.object({ artifactId: z.uuid().optional(), projectId: z.uuid().optional() })
	.refine((value) => (value.artifactId === undefined) !== (value.projectId === undefined), {
		message: "exactly one of artifactId or projectId",
	})

export const InviteSuggestionSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	email: z.email(),
	/** Invited by email and not signed in yet. */
	pending: z.boolean(),
})

/** A Group with no Grant on the target yet. Only the Owner grants to a Group, so only the Owner is offered any. */
export const GroupSuggestionSchema = z.object({ id: z.uuid(), name: z.string(), memberCount: z.number().int() })

/** The Share dialog's quick chips ask for a few; the Invite view's checklist asks for up to this many. */
export const MAX_INVITE_SUGGESTIONS = 50

export const ListInviteSuggestionsQuerySchema = z
	.object({
		artifactId: z.uuid().optional(),
		projectId: z.uuid().optional(),
		q: z.string().max(200).optional(),
		limit: z.coerce.number().int().min(1).max(MAX_INVITE_SUGGESTIONS).optional(),
	})
	.refine((value) => (value.artifactId === undefined) !== (value.projectId === undefined), {
		message: "exactly one of artifactId or projectId",
	})

export const CreateGrantBodySchema = z
	.object({
		artifactId: z.uuid().optional(),
		projectId: z.uuid().optional(),
		/** A person by email, or `groupId`: a Group of the target's Team, which only the Owner may name. One of the two. */
		granteeEmail: z.email().optional(),
		groupId: z.uuid().optional(),
		role: GrantRoleSchema,
		/** Owner only, Artifact Grants only: pin the new Grant (null = follow latest). Omitted = the Default Pin. */
		pinnedRevisionId: z.uuid().nullable().optional(),
	})
	.refine((value) => (value.artifactId === undefined) !== (value.projectId === undefined), {
		message: "exactly one of artifactId or projectId",
	})
	.refine((value) => (value.granteeEmail === undefined) !== (value.groupId === undefined), {
		message: "exactly one of granteeEmail or groupId",
	})

export const UpdateGrantRoleBodySchema = z.object({ role: GrantRoleSchema })
export const UpdateGrantPinBodySchema = z.object({ pinnedRevisionId: z.uuid().nullable() })
export const SetDefaultPinBodySchema = z.object({ defaultPin: DefaultPinSchema })

export type InviteSuggestionView = z.infer<typeof InviteSuggestionSchema>
export type GroupSuggestionView = z.infer<typeof GroupSuggestionSchema>
export type GrantView = z.infer<typeof GrantSchema>
