import { z } from "zod"

import { InviteRoleSchema } from "../workspace/types"

/** A Join Link's token. Loose on purpose: a malformed token answers like an unknown one. */
export const InviteTokenSchema = z.string().min(1).max(200)

/** A password being set, at sign-up or through a Reset Link. */
export const NewPasswordSchema = z.string().min(12).max(200)

/** A Reset Link's token. Loose on purpose: a malformed token answers like an unknown one. */
export const ResetTokenSchema = z.string().min(1).max(200)

export const SignUpBodySchema = z
	.strictObject({
		email: z.email(),
		name: z.string().min(1).max(200),
		password: NewPasswordSchema,
		workspaceName: z.string().min(1).max(200).optional(),
		inviteToken: InviteTokenSchema.optional(),
	})
	.refine(({ inviteToken, workspaceName }) => inviteToken === undefined || workspaceName === undefined, {
		message: "An invite already names the workspace.",
		path: ["inviteToken"],
	})

export const SignInBodySchema = z.object({
	email: z.email(),
	password: z.string().min(1).max(200),
})

export const SessionUserSchema = z.object({
	id: z.uuid(),
	workspaceId: z.uuid(),
	email: z.email(),
	name: z.string(),
	isAdmin: z.boolean(),
	googleLinked: z.boolean(),
	createdAt: z.date(),
})

export const WorkspaceKindSchema = z.enum(["personal", "team"])

export const LiveWorkspaceSchema = z.object({
	id: z.uuid(),
	kind: WorkspaceKindSchema,
	name: z.string(),
	role: InviteRoleSchema,
})

/**
 * The signed-in person as `me` returns them, acting in their session's Workspace: `workspaceId`, `workspaceName`
 * and `isAdmin` are that Workspace's, `workspaceKind` says what it is, and `workspaces` lists everything the person
 * can switch to, their Personal Workspace first. The flat fields stay as shipped iOS builds decode them.
 * `appleLinked` says whether Settings still offers Connect Apple.
 */
export const MeSchema = SessionUserSchema.extend({
	appleLinked: z.boolean(),
	workspaceName: z.string(),
	workspaceKind: WorkspaceKindSchema,
	workspaces: z.array(LiveWorkspaceSchema),
})

export const SwitchWorkspaceBodySchema = z.strictObject({ workspaceId: z.uuid() })

export const SignedOutSchema = z.object({ signedOut: z.literal(true) })

export const EditionNameSchema = z.enum(["community", "cloud"])
export type EditionName = z.infer<typeof EditionNameSchema>

export const EditionCapabilitiesSchema = z.object({
	aiEdit: z.boolean(),
	redaction: z.boolean(),
	notificationEmail: z.boolean(),
	generalAccess: z.boolean(),
	adminInvites: z.boolean(),
	viewMode: z.boolean(),
})
export type EditionCapabilities = z.infer<typeof EditionCapabilitiesSchema>

export const NO_CAPABILITIES: EditionCapabilities = {
	aiEdit: false,
	redaction: false,
	notificationEmail: false,
	generalAccess: false,
	adminInvites: false,
	viewMode: false,
}

/**
 * Deleting one's own account. `confirmEmail` is the account's address as the person typed it; it must match
 * ignoring case and surrounding spaces. `appleAuthorizationCode` is a fresh code from Sign in with Apple, which an app
 * sends when the account has an Apple identity so its token can be revoked with Apple.
 */
export const DeleteAccountBodySchema = z.strictObject({
	confirmEmail: z.string().max(320),
	appleAuthorizationCode: z.string().min(1).max(2048).optional(),
})

export const AccountDeletedSchema = z.object({ deleted: z.literal(true) })

/**
 * What this install offers before sign-in. `signUp` is false on an invite-only install once it has an
 * account; `aiEdit` is false when it runs without a model key. `emailCode` is true when the install has mail, which
 * email sign-in needs to deliver its link and code. `apple` shows the Continue with Apple button, and is true when the
 * install has its Apple keys. `appleNative` is true when the iPhone and Mac apps may sign in with Apple
 * through `signInWithAppleNative`.
 */
export const AuthProvidersSchema = z.object({
	google: z.boolean(),
	apple: z.boolean(),
	appleNative: z.boolean(),
	emailCode: z.boolean(),
	signUp: z.boolean(),
	/** Alias of `capabilities.aiEdit`, kept for shipped native clients. */
	aiEdit: z.boolean(),
	edition: EditionNameSchema,
	capabilities: EditionCapabilitiesSchema,
})

export const ResetPasswordBodySchema = z.object({
	token: ResetTokenSchema,
	password: NewPasswordSchema,
})

/** What a Reset Link's page shows before the new password is set. */
export const ResetLinkPreviewSchema = z.object({
	email: z.string(),
	workspaceName: z.string(),
})

/** What a Join Link's page shows before sign-up. */
export const InvitePreviewSchema = z.object({
	email: z.string(),
	role: InviteRoleSchema,
	workspaceName: z.string(),
})
