import { useAuthProviders } from "@/features/auth/hooks/useAuthProviders"

/**
 * Copies the link a sharer sends to someone invited who has not signed in yet. Exagram emails no one, so this
 * link is how they arrive; `?invited=1` makes the sign-in page say to use the invited address.
 */
export const copyInviteLink = (url: string, email: string, toast: (message: string) => void) =>
	navigator.clipboard.writeText(`${url}?invited=1`).then(
		() => toast(`Link copied — send it to ${email}`),
		() => toast("Could not copy — select the URL and copy it"),
	)

/** An invited person's meta when a copied link would be useless: only an Admin's Join Link brings them in. */
export const NEEDS_JOIN_LINK = "Needs an invite link — an Admin creates one in Settings → Team → Invite member"

/**
 * The `?invited=1` link only helps someone who can sign in with Google as the invited address. Without Google a
 * Join Link claims the row, so there is nothing to copy. Read through `edition.useInviteLinkCopyable`.
 */
export const useGoogleInviteLinkCopyable = () => useAuthProviders().data?.google === true
