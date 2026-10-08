import { API_ORIGIN } from "@/config/env"
import { useAuthProviders } from "@/features/auth/hooks/useAuthProviders"
import { useMe } from "@/features/auth/hooks/useMe"

/**
 * "Connect Google" for a password account: offered only while this instance has Google sign-in and the
 * signed-in person has not linked one yet. `href` starts the link flow on the API.
 */
export const useGoogleLink = () => {
	const me = useMe()
	const providers = useAuthProviders()
	const href = new URL("/v1/auth/google/start", API_ORIGIN)
	href.search = new URLSearchParams({ mode: "link" }).toString()
	return {
		available: providers.data?.google === true && me.data?.googleLinked === false,
		href: href.toString(),
	}
}
