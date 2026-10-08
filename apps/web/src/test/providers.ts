import { COMMUNITY_CAPABILITIES } from "@exagram/api-client"

/** What `GET /auth/providers` answers, with Google on or off. */
export const providersFixture = (google: boolean) => ({
	google,
	signUp: true,
	aiEdit: true,
	edition: "cloud" as const,
	capabilities: { ...COMMUNITY_CAPABILITIES, aiEdit: true },
})
