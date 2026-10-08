import type { EditionModule } from "./edition.port"

import { useGoogleInviteLinkCopyable } from "@/features/grants/sheets/inviteLink"
import { accountLine, workspaceCopy } from "@/features/workspace/workspaceCopy"

export const edition: EditionModule = {
	publicRoutes: [],
	settingsPages: {},
	WorkspaceSection: null,
	WorkspaceNotificationEmailSettings: null,
	NotificationEmailSettings: null,
	useRedactionCapability: () => "disabled",
	ProjectRedactionSection: null,
	ArtifactRedactionSection: null,
	ViewAsAiSection: null,
	ConnectionRedactionPicker: null,
	SignUpWorkspaceFields: null,
	SignUpGoogle: null,
	generalAccessOrg: false,
	adminInvites: false,
	redactionCheck: false,
	useInviteLinkCopyable: useGoogleInviteLinkCopyable,
	OpenInAppBanner: null,
	openInAppItems: () => [],
	clickOpensTab: () => false,
	MacAppSettings: null,
	// Invites from Admins only (P68), handed over as links (P60); no Join Requests or Seat Limit (P61).
	useTeamJoining: () => ({ ready: true, emailed: false, domain: null, memberInvites: false, error: null }),
	useTeamRequests: () => ({ count: 0, section: null, seatsLine: null, errors: [] }),
	useArtifactEeActions: () => ({ items: [], dialogs: null }),
	recapSample: null,
	accountLine,
	copy: {
		...workspaceCopy,
		generalAccessOrg: {
			label: () => "Anyone on the allowed domain",
			description: () => "Anyone signed in on the allowed domain who has the link can view",
			copied: () => "Link copied",
			chosen: () => "Anyone on the allowed domain with the link can now view.",
			details: () => "Anyone on the allowed domain with the link",
			needsDomain: () => "An Admin needs to set an allowed domain first",
		},
		googleErrors: {},
		generalSubline: "The account you are signed in with.",
		provenanceSummary: "Import details",
		demoteYourself:
			"You lose Admin access. You can no longer invite people, change roles or remove members, and only another Admin can make you an Admin again.",
	},
}
