import { NO_CAPABILITIES } from "@exagram/core/contract/auth/types"

import { noArtifactRedaction } from "./usecase/artifacts/artifact-redaction.port"

import type { CoreRouter, EditionInput, EditionWiring } from "./edition.port"

/** Needs no extra wiring, so it reads nothing from the input; `index.ts` passes it to every edition root. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter documents the shared call shape
export function createEdition(_input?: EditionInput): EditionWiring {
	return {
		name: "community",
		capabilities: NO_CAPABILITIES,
		signUpMode: "invite",
		adminPasswordReset: true,
		inviteRoles: ["member"],
		membersMayInvite: false,
		inviteWithoutGoogle: true,
		emailSignInEnabled: false,
		appleNativeEnabled: false,
		appleNativeClientIds: [],
		nativeHandoff: null,
		workspaceLabel: () => "Exagram",
		apiCopy: { accountRemoved: "This account was removed.", lastAdmin: "There must be at least one Admin." },
		redactionEnabled: false,
		artifactRedaction: noArtifactRedaction,
		extendRouter: (router: CoreRouter) => router,
		createQueues: async () => {},
		registerRoutes: () => {},
		originGuardExemptPaths: [],
		inviteMailer: null,
		generalAccessLevels: ["restricted", "anyone"],
	}
}
