declare module "oidc-provider/lib/helpers/fetch_request.js" {
	import type Provider from "oidc-provider"

	export default function fetchRequest(provider: Provider, url: string, options: RequestInit): Promise<Response>
}
