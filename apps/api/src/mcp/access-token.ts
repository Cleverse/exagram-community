import { type Provider } from "oidc-provider"

import { type IntrospectedToken } from "./bearer"

/** An AccessToken can outlive its Grant (a refresh winner saves after a revoke), so a missing Grant means not found. */
export function createFindAccessToken(
	provider: Pick<Provider, "AccessToken" | "Grant">,
): (token: string) => Promise<IntrospectedToken | undefined> {
	return async (token) => {
		const found = await provider.AccessToken.find(token)
		if (!found) return undefined
		if (!found.grantId || !(await provider.Grant.find(found.grantId))) return undefined
		return { aud: found.aud, grantId: found.grantId, scope: found.scope, exp: found.exp }
	}
}
