import { createORPCClient } from "@orpc/client"
import { type AnyContractRouter, type ContractRouterClient } from "@orpc/contract"
import { OpenAPILink } from "@orpc/openapi-client/fetch"

export const createRawClient = <T extends AnyContractRouter>(
	contract: T,
	baseApiUrl: string,
): ContractRouterClient<T> => {
	const link = new OpenAPILink(contract, {
		url: baseApiUrl,
		// The human API authenticates with a session cookie, so every request carries it.
		fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: "include" }),
	})

	return createORPCClient(link)
}
