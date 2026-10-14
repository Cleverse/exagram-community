import { useAuthProviders } from "@/features/auth/hooks/useAuthProviders"
import { useMe } from "@/features/auth/hooks/useMe"
import { providerStartUrl } from "@/features/auth/providerStart"

/**
 * "Connect Apple" for a signed-in account: offered while this instance has Sign in with Apple and the person has not
 * linked one yet. `shown` says whether Settings lists Apple at all, which it skips on an install without it unless the
 * account already holds one. `href` starts the link flow on the API.
 */
export const useAppleLink = () => {
	const me = useMe()
	const providers = useAuthProviders()
	const offered = providers.data?.apple === true
	const linked = me.data?.appleLinked === true
	const href = new URL(providerStartUrl("apple", {}))
	href.searchParams.set("mode", "link")
	return {
		shown: offered || linked,
		linked,
		available: offered && me.data?.appleLinked === false,
		href: href.toString(),
	}
}
