import { isApiError } from "@exagram/api-client"

export const SIGN_UP_INVITE_ONLY = "Sign-up on this install is by invitation. Ask your Admin for an invite link."

export const ALREADY_IN_TEAM_JOIN =
	"You're already in a team. An account can belong to only one team, so it can't join this one."
export const ALREADY_IN_TEAM_CREATE =
	"You're already in a team. An account can belong to only one team, so it can't create another."

const ALREADY_IN_TEAM_CODE = "ALREADY_IN_TEAM"

export const isAlreadyInTeam = (error: unknown): boolean => isApiError(error) && error.code === ALREADY_IN_TEAM_CODE

export const joinErrorMessage = (error: Error): string =>
	isAlreadyInTeam(error) ? ALREADY_IN_TEAM_JOIN : error.message

export const signInErrorMessages: Record<string, string> = {
	google_denied: "Google sign-in was cancelled.",
	google_failed: "Google sign-in failed. Try again.",
	account_exists:
		"An account with that email already exists. Sign in with your password, then connect Google from the account menu.",
	google_no_account: "Google could not finish creating your account. Try again from Sign up.",
	google_invalid_request: "Could not start Google sign-in. Check your details and try again.",
	google_already_in_team: ALREADY_IN_TEAM_JOIN,
	google_rate_limited: "Too many Google sign-in attempts. Wait a minute and try again.",
	google_signup_invite_only: SIGN_UP_INVITE_ONLY,
	google_invite_invalid: "This invite is no longer valid. Ask your Admin for a new link.",
	google_invite_mismatch:
		"This invite is for a different email address. Continue with Google using the invited address.",
	apple_denied: "Apple sign-in was cancelled.",
	apple_failed: "Apple sign-in failed. Try again.",
	apple_invalid_request: "Could not start Apple sign-in. Try again.",
	apple_rate_limited: "Too many Apple sign-in attempts. Wait a minute and try again.",
	apple_no_email: "Apple did not share an email address. Try again and share your email or use Hide My Email.",
	apple_account_exists:
		"An account with that email already exists. Sign in another way, then connect Apple from the account menu.",
	apple_signup_invite_only: SIGN_UP_INVITE_ONLY,
	apple_already_in_team: ALREADY_IN_TEAM_JOIN,
}

/** A sign-in redirect's `error` code as a sentence: the shared messages, then the edition's own. */
export const googleAuthError = (code: string | null, extra: Readonly<Record<string, string>>): string | undefined =>
	code === null ? undefined : (signInErrorMessages[code] ?? extra[code])
