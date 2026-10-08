import { type coreContract } from "@exagram/core/contract"

import { type AuthProviders, type InvitePreview, type Me, type ResetLinkPreview, type SessionUser } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith, failWithUserMessage, statusOf } from "../utils/errors"
import { unwrapResult } from "../utils/result"

/**
 * A 404 stays one message for every unusable token. A rate limit is not a refusal, so its server message comes
 * through; anything else says the link could not be checked, not that it is dead.
 */
export const previewFailure = (error: unknown, dead: string, other: string): never => {
	const status = statusOf(error)
	if (status === 404) return failWith(error, dead)
	if (status === 429 && error instanceof Error) return failWith(error, error.message)
	return failWith(error, other)
}

export class AuthRouter extends Router<typeof coreContract> {
	async providers(): Promise<AuthProviders> {
		try {
			return unwrapResult(await this.client.auth.providers({}))
		} catch (error) {
			return failWith(error, "Could not load sign-in providers")
		}
	}

	/** A wrong, expired, revoked or used Join Link all fail the same way. */
	async previewInvite(input: { token: string }): Promise<InvitePreview> {
		try {
			return unwrapResult(await this.client.auth.previewInvite({ params: input }))
		} catch (error) {
			return previewFailure(error, "This invite is no longer valid", "Could not check this invite")
		}
	}

	/** A wrong, expired or used Reset Link all fail the same way. */
	async previewResetLink(input: { token: string }): Promise<ResetLinkPreview> {
		try {
			return unwrapResult(await this.client.auth.previewResetLink({ params: input }))
		} catch (error) {
			return previewFailure(error, "This reset link is no longer valid", "Could not check this reset link")
		}
	}

	/** Sets the new password and signs in; every other session of the account has ended. */
	async resetPassword(input: { token: string; password: string }): Promise<SessionUser> {
		try {
			return unwrapResult(await this.client.auth.resetPassword({ body: input }))
		} catch (error) {
			return failWithUserMessage(error, "Could not set the new password")
		}
	}

	async signUp(input: {
		email: string
		name: string
		password: string
		workspaceName?: string
		inviteToken?: string
	}): Promise<SessionUser> {
		try {
			return unwrapResult(await this.client.auth.signUp({ body: input }))
		} catch (error) {
			return failWithUserMessage(error, "Could not create that account")
		}
	}

	/** One message for a wrong address and a wrong password alike. */
	async signIn(input: { email: string; password: string }): Promise<SessionUser> {
		try {
			return unwrapResult(await this.client.auth.signIn({ body: input }))
		} catch (error) {
			return failWith(error, "That email and password do not match")
		}
	}

	async signOut(): Promise<void> {
		try {
			await this.client.auth.signOut({})
		} catch (error) {
			failWith(error, "Could not sign out")
		}
	}

	async me(): Promise<Me> {
		try {
			return unwrapResult(await this.client.auth.me({}))
		} catch (error) {
			return failWith(error, "Not signed in")
		}
	}
}
