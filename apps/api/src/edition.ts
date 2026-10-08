import { COMMUNITY_CAPABILITIES } from "@exagram/core/contract/auth/types"

import { noArtifactRedaction } from "./usecase/artifacts/artifact-redaction.port"

import type { CommunityRouter, EditionInput, EditionWiring } from "./edition.port"

/** Community builds nothing from the input; taking it keeps the shared call the same in both trees. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter documents the shared call shape
export function createEdition(_input?: EditionInput): EditionWiring {
	return {
		name: "community",
		capabilities: COMMUNITY_CAPABILITIES,
		signUpMode: "invite",
		adminPasswordReset: true,
		inviteRoles: ["member"],
		membersMayInvite: false,
		inviteWithoutGoogle: true,
		nativeHandoff: null,
		workspaceLabel: () => "Exagram",
		firstWorkspaceName: () => "Exagram",
		apiCopy: { accountRemoved: "This account was removed.", lastAdmin: "There must be at least one Admin." },
		redactionEnabled: false,
		artifactRedaction: noArtifactRedaction,
		extendRouter: (router: CommunityRouter) => router,
		createQueues: async () => {},
		registerRoutes: () => {},
		originGuardExemptPaths: [],
		inviteMailer: null,
		generalAccessLevels: ["restricted", "anyone"],
	}
}
