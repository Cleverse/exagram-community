export const SIGN_UP_INVITE_ONLY = "Sign-up on this install is by invitation. Ask your Admin for an invite link."

export const googleAuthErrorMessages: Record<string, string> = {
	google_denied: "Google sign-in was cancelled.",
	google_failed: "Google sign-in failed. Try again.",
	account_exists:
		"An account with that email already exists. Sign in with your password, then connect Google from the account menu.",
	google_no_account: "Google could not finish creating your account. Try again from Sign up.",
	google_invalid_request: "Could not start Google sign-in. Check your details and try again.",
	google_rate_limited: "Too many Google sign-in attempts. Wait a minute and try again.",
	google_signup_invite_only: SIGN_UP_INVITE_ONLY,
	google_invite_invalid: "This invite is no longer valid. Ask your Admin for a new link.",
	google_invite_mismatch:
		"This invite is for a different email address. Continue with Google using the invited address.",
}

/** A Google redirect's `error` code as a sentence: the shared messages, then the edition's own (P29). */
export const googleAuthError = (code: string | null, extra: Readonly<Record<string, string>>): string | undefined =>
	code === null ? undefined : (googleAuthErrorMessages[code] ?? extra[code])
