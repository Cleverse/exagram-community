import { type AuthProviders, NO_CAPABILITIES } from "@exagram/api-client"

/** What `auth.providers` answers on a bare install; a test names only what it turns on. */
export const authProviders = (overrides: Partial<AuthProviders> = {}): AuthProviders => ({
	google: false,
	apple: false,
	appleNative: false,
	emailCode: false,
	signUp: true,
	aiEdit: true,
	edition: "community",
	capabilities: NO_CAPABILITIES,
	...overrides,
})
