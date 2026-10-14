import { API_ORIGIN } from "@/config/env"
import { edition } from "@/edition/edition"
import { useAuthProviders } from "@/features/auth/hooks/useAuthProviders"
import { useMe } from "@/features/auth/hooks/useMe"

/**
 * "Connect Google" for a password account: offered only while this instance has Google sign-in and the
 * signed-in person has not linked one yet. `shown` says whether Settings lists Google at all, which an edition that follows the
 * providers answer skips once the install has no Google sign-in, unless the account already holds one. `href` starts the link flow on
 * the API.
 */
export const useGoogleLink = () => {
	const me = useMe()
	const providers = useAuthProviders()
	const href = new URL("/v1/auth/google/start", API_ORIGIN)
	href.search = new URLSearchParams({ mode: "link" }).toString()
	return {
		shown: !edition.followsProviders || providers.data?.google !== false || me.data?.googleLinked === true,
		available: providers.data?.google === true && me.data?.googleLinked === false,
		href: href.toString(),
	}
}
