import { COMMUNITY_CAPABILITIES, type EditionCapabilities } from "@exagram/api-client"

import { useAuthProviders } from "./useAuthProviders"

/**
 * What the server says this install can do. Loading, an error, a failed refetch over cached data, or an api older than
 * the web (no `capabilities` in its answer) reads as off.
 */
export const useCapabilities = (): EditionCapabilities => {
	const providers = useAuthProviders()
	if (providers.isError) return COMMUNITY_CAPABILITIES
	return providers.data?.capabilities ?? COMMUNITY_CAPABILITIES
}
