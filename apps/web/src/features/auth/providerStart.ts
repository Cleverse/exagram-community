import { API_ORIGIN } from "@/config/env"

export type SignInProvider = "google" | "apple"

export type ProviderStartProps = {
	/** A Join Link's token; the Invite names the Workspace, so it goes alone. Google only. */
	inviteToken?: string
	/** Google only. */
	domainLinkId?: string
	choice?: { join: string } | "create"
	/** A file path to land on after sign-in; the API drops anything that is not `/artifacts/{id}` or `/projects/{id}`. */
	returnTo?: string
}

/** The API route that starts a provider's sign-in, carrying at most one way to join, or else a file to land on. */
export const providerStartUrl = (
	provider: SignInProvider,
	{ inviteToken, domainLinkId, choice, returnTo }: ProviderStartProps,
): string => {
	const url = new URL(`/v1/auth/${provider}/start`, API_ORIGIN)
	const params = new URLSearchParams()
	if (inviteToken) params.set("inviteToken", inviteToken)
	else if (domainLinkId) params.set("domainLinkId", domainLinkId)
	else if (choice === "create") params.set("choice", "create")
	else if (choice) {
		params.set("choice", "join")
		params.set("workspaceId", choice.join)
	} else if (returnTo) params.set("returnTo", returnTo)
	url.search = params.toString()
	return url.toString()
}
