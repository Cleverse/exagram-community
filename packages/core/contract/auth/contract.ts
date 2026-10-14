import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import {
	AccountDeletedSchema,
	AuthProvidersSchema,
	DeleteAccountBodySchema,
	InvitePreviewSchema,
	InviteTokenSchema,
	MeSchema,
	ResetLinkPreviewSchema,
	ResetPasswordBodySchema,
	ResetTokenSchema,
	SessionUserSchema,
	SignedOutSchema,
	SignInBodySchema,
	SignUpBodySchema,
	SwitchWorkspaceBodySchema,
} from "./types"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const authContract = oc.router({
	providers: base
		.route({ method: "GET", path: "/auth/providers" })
		.input(z.object({}))
		.output(responseSchema(AuthProvidersSchema)),

	previewInvite: base
		.route({ method: "GET", path: "/auth/invites/{token}" })
		.input(z.object({ params: z.object({ token: InviteTokenSchema }) }))
		.output(responseSchema(InvitePreviewSchema)),

	previewResetLink: base
		.route({ method: "GET", path: "/auth/reset/{token}" })
		.input(z.object({ params: z.object({ token: ResetTokenSchema }) }))
		.output(responseSchema(ResetLinkPreviewSchema)),

	resetPassword: base
		.route({ method: "POST", path: "/auth/reset" })
		.input(z.object({ body: ResetPasswordBodySchema }))
		.output(responseSchema(SessionUserSchema)),

	signUp: base
		.route({ method: "POST", path: "/auth/sign-up" })
		.input(z.object({ body: SignUpBodySchema }))
		.output(responseSchema(SessionUserSchema)),

	signIn: base
		.route({ method: "POST", path: "/auth/sign-in" })
		.input(z.object({ body: SignInBodySchema }))
		.output(responseSchema(SessionUserSchema)),

	signOut: base
		.route({ method: "POST", path: "/auth/sign-out" })
		.input(z.object({}))
		.output(responseSchema(SignedOutSchema)),

	/**
	 * Deletes the signed-in person's account for good and signs them out everywhere. A confirmation that is
	 * not the account's address answers 400; a Workspace Owner whose Team has other Members answers 409.
	 */
	deleteAccount: base
		.route({ method: "POST", path: "/auth/account/delete" })
		.input(z.object({ body: DeleteAccountBodySchema }))
		.output(responseSchema(AccountDeletedSchema)),

	me: base.route({ method: "GET", path: "/auth/me" }).input(z.object({})).output(responseSchema(MeSchema)),

	/**
	 * Moves the caller's session to another Workspace they are a live member of, and answers `me` for it. A Workspace
	 * that does not exist and one the caller is not in answer the same 404.
	 */
	switchWorkspace: base
		.route({ method: "POST", path: "/auth/workspace" })
		.input(z.object({ body: SwitchWorkspaceBodySchema }))
		.output(responseSchema(MeSchema)),
})
