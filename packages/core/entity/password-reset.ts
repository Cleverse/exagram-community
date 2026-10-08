import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "./auth"

import type { UserWithSecret } from "./auth"

/** How long a Reset Link works after it is created (ADR 0034). */
export const RESET_LINK_TTL_MS = 60 * 60 * 1000

/** What the reset page shows before a new password is set. */
export interface ResetLinkPreview {
	email: string
	workspaceName: string
}

/** A Reset Link taken for use. A null `createdBy` is the server operator's command; otherwise an Admin made it. */
export interface TakenResetLink {
	userId: string
	email: string
	createdBy: string | null
}

/**
 * Whether an account may have a Reset Link, checked when one is made and again when it is used. A Reset
 * Link replaces a forgotten password and never adds one, so the account needs a real password hash: not
 * Google-only (null), not invited, still a member somewhere, not seeded for a Google claim.
 */
export const isResettable = (user: UserWithSecret): boolean =>
	user.invitedAt === null &&
	user.hasLiveMembership &&
	user.passwordHash !== null &&
	user.passwordHash !== GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL

/** A Reset Link just created: its URL exists only in this value. */
export interface IssuedResetLink {
	url: string
	expiresAt: Date
}
