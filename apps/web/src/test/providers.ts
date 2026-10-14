import { NO_CAPABILITIES } from "@exagram/api-client"

/** What `GET /auth/providers` answers, with Google on or off. */
export const providersFixture = (google: boolean) => ({
	google,
	apple: false,
	appleNative: false,
	emailCode: false,
	signUp: true,
	aiEdit: true,
	edition: "community" as const,
	capabilities: NO_CAPABILITIES,
})
