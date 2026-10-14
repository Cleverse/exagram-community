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

/**
 * Email sign-in's refusals are written for the person: a wrong code (401), a closed sign-up or a pending join (403),
 * a wait (429), no mailer (503). Those keep the server's sentence and code; anything else says `fallback`.
 */
const SERVER_SENTENCE_STATUSES = new Set([400, 401, 403, 409, 429, 503])
export const failWithServerSentence = (error: unknown, fallback: string): never =>
	failWith(error, SERVER_SENTENCE_STATUSES.has(statusOf(error)) && error instanceof Error ? error.message : fallback)

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

	async signUp(input: { email: string; name: string; password: string; inviteToken?: string }): Promise<SessionUser> {
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

	/**
	 * Deletes the account for good and signs the person out everywhere. A confirmation that is not the account's
	 * address (400) and a Team that needs another owner first (409) keep the server's sentence.
	 */
	async deleteAccount(input: { confirmEmail: string; appleAuthorizationCode?: string }): Promise<void> {
		try {
			unwrapResult(await this.client.auth.deleteAccount({ body: input }))
		} catch (error) {
			failWithServerSentence(error, "Could not delete your account. Try again.")
		}
	}

	async me(): Promise<Me> {
		try {
			return unwrapResult(await this.client.auth.me({}))
		} catch (error) {
			return failWith(error, "Not signed in")
		}
	}

	/**
	 * A Workspace that does not exist and one the person cannot enter both answer 404, which stays one message; a
	 * rate limit's own message comes through.
	 */
	async switchWorkspace(input: { workspaceId: string }): Promise<Me> {
		try {
			return unwrapResult(await this.client.auth.switchWorkspace({ body: input }))
		} catch (error) {
			return failWithUserMessage(error, "Could not switch workspace")
		}
	}
}
