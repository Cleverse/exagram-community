import type { EditionModule } from "./edition.port"

import { useGoogleInviteLinkCopyable } from "@/features/grants/sheets/inviteLink"
import { accountLine, workspaceCopy } from "@/features/workspace/workspaceCopy"

export const edition: EditionModule = {
	publicRoutes: [],
	settingsPages: {},
	WorkspaceSection: null,
	WorkspaceNotificationEmailSettings: null,
	notificationSettings: false,
	NotificationEmailSettings: null,
	useRedactionCapability: () => "disabled",
	ProjectRedactionSection: null,
	ArtifactRedactionSection: null,
	ViewAsAiSection: null,
	ConnectionRedactionPicker: null,
	generalAccessOrg: false,
	adminInvites: false,
	redactionCheck: false,
	useInviteLinkCopyable: useGoogleInviteLinkCopyable,
	OpenInAppBanner: null,
	openInAppItems: () => [],
	clickOpensTab: () => false,
	MacAppSettings: null,
	DesktopAppLink: null,
	ServerFooter: null,
	// Only Admins invite, and each Invite is handed over as a link; nobody waits for approval and Seats are unlimited.
	useTeamJoining: () => ({
		ready: true,
		emailed: false,
		domain: null,
		memberInvites: false,
		error: null,
		tab: null,
		section: null,
	}),
	useTeamRequests: () => ({ count: 0, section: null, seatsLine: null, errors: [] }),
	useTeamRequestsMobile: () => ({ count: 0, section: null, seatsLine: null, errors: [] }),
	// A Team's default role for new shares is set only in Joining settings, so here it stays the column's default.
	useTeamDefaultShareRole: (enabled) => (enabled ? "collaborate" : undefined),
	useEditionArtifactActions: () => ({ items: [], dialogs: null }),
	pins: false,
	tags: false,
	projectRules: false,
	followsProviders: true,
	auditCost: false,
	recapSample: null,
	connectorDocs: null,
	useEmailSignInSend: () => null,
	emailSignIn: null,
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
		forgotPassword: "Forgot your password? Ask an Admin for a reset link.",
		deleteArtifact: {
			confirm: "After this, nobody can open it, you included.",
			done: (title) => `Deleted "${title}".`,
		},
		signUpIntro:
			"You're the first person on this install, so this account becomes its Admin. Sign-up then closes, and everyone else joins with an invite link from an Admin.",
		demoteYourself:
			"You lose Admin access. You can no longer invite people, change roles or remove members, and only another Admin can make you an Admin again.",
	},
}
