import type { Connection, GrantRole, VisibleArtifact, WorkspaceKind } from "@exagram/api-client"

import type { MenuItem } from "@/components/ui/Menu"
import type { RecapFile, RecapProject } from "@/features/context/recap"
import type { OrgAccessCopy } from "@/features/grants/general-access/generalAccess"
import type { SettingsTab } from "@/routes/paths"
import type { UseMutationResult } from "@tanstack/react-query"
import type { ComponentType, FormEvent, ReactElement, ReactNode } from "react"
import type { RouteObject } from "react-router"

export type Variant = "desktop" | "mobile"

export interface EditionArtifactActions {
	items: MenuItem[]
	dialogs: ReactNode
}

/** Sentences that differ by edition: invites, joining, sign-up, and the ones that name the Workspace. */
export interface EditionCopy {
	/** Under the account's name in the account menu and the nav drawer; null hides the line. */
	accountWorkspace(workspaceName: string | undefined): string | null
	joinTitle(workspaceName: string): string
	joinLine(workspaceName: string, role: "admin" | "member"): string
	resetLine(workspaceName: string): string
	/** A share recipient who has no account yet. */
	newTo(workspaceName: string | undefined): string
	notInYet(workspaceName: string | undefined): string
	notInYetSendLink(workspaceName: string | undefined): string
	/** The General Access `org` choice's sentences, also used for a stored `org` where the menu does not offer it. */
	generalAccessOrg: OrgAccessCopy
	/** Google and Apple sign-in error codes beyond the shared ones, by code; empty where the edition adds none. */
	googleErrors: Readonly<Record<string, string>>
	/** The Team page's remove button: its tooltip, and its label for a screen reader. */
	removeMemberTitle: string
	removeMemberLabel(memberName: string): string
	/** The confirm dialog when an Admin demotes themself. */
	demoteYourself: string
	/** The toast when an Invite is refused because the caller may no longer invite. */
	inviteRefused: string
	/** Settings → General's subline under its heading. */
	generalSubline: string
	/** The summary of a Revision's provenance in History. */
	provenanceSummary: string
	/** Under the sign-in card's password form: what to do about a forgotten password; null leaves it out. */
	forgotPassword: string | null
	/** The sign-up card's lead paragraph. */
	signUpIntro: string
	/** Deleting a file: the sentence its confirmation shows, and the toast once it is gone. */
	deleteArtifact: { confirm: string; done(title: string): string }
}

/**
 * The joining settings the Team page and the mobile Invites block read; an edition without Joining settings returns
 * fixed values.
 */
export interface TeamJoining {
	ready: boolean
	emailed: boolean
	domain: string | null
	memberInvites: boolean
	error: Error | null
	/** The Admin's "Joining & sharing" tab on the desktop Team page; null leaves the tab out. */
	tab: ReactElement | null
	/** The Admin's "Joining and sharing" section at the foot of the mobile Team page; null leaves it out. */
	section: ReactElement | null
}

/** Join Requests and the Seat count on the Team page; an edition without them returns a zero count and null parts. */
export interface TeamRequests {
	count: number
	section: ReactNode
	seatsLine: string | null
	errors: readonly (Error | null)[]
}

/** Sending the sign-in email, as the sign-in card's first step holds it. */
export type EmailSignInSend = UseMutationResult<void, Error, { email: string; returnTo?: string }>

/** Email Sign-in's parts of the sign-in page; null where no sign-in email is sent. */
export interface EmailSignIn {
	/** The email-first form the card shows instead of the password form. */
	StartForm: ComponentType<{
		email: string
		onEmailChange: (email: string) => void
		pending: boolean
		onSubmit: (event: FormEvent) => void
	}>
	/** The link that swaps the card between the password form and the code; `toCode` while the password form shows. */
	MethodSwitch: ComponentType<{ toCode: boolean; onSwitch: () => void }>
	/** The code step and any join offer after it, each in its own card; `onBack` returns to the first step. */
	Steps: ComponentType<{ email: string; returnTo: string | undefined; onSignedIn: () => void; onBack: () => void }>
}

/** The design's sample week, which the weekly recap shows while the library has loaded empty. */
export interface RecapSample {
	files(): RecapFile[]
	projects(): RecapProject[]
}

/** Whether redaction is on in the session's Workspace; "loading" until it is known. */
export type RedactionCapability = "loading" | "enabled" | "disabled"

export interface EditionModule {
	/** Routes outside the app frame (email confirmation, unsubscribe, the sign-in email's link). */
	publicRoutes: RouteObject[]
	/** Settings tabs only this edition has, with their desktop and mobile page. */
	settingsPages: Partial<Record<SettingsTab, { desktop: ComponentType; mobile: ComponentType }>>
	/** The Workspace card (name and ID) in Settings → General. */
	WorkspaceSection: ComponentType<{ variant: Variant }> | null
	/** The Admin's Notification Email settings in Settings → General. */
	WorkspaceNotificationEmailSettings: ComponentType<{ variant: Variant }> | null
	/**
	 * Whether Settings has the Notifications tab, where a member picks what the Mac and iPhone apps notify them about;
	 * false leaves the tab out.
	 */
	notificationSettings: boolean
	/** A member's own email address and cadence in Settings → Notifications. */
	NotificationEmailSettings: ComponentType<{ variant: Variant }> | null
	/**
	 * Gates every redaction control and the Security tab. Fails closed: an error reads "disabled". An edition without
	 * redaction answers "disabled" without asking the server.
	 */
	useRedactionCapability: () => RedactionCapability
	ProjectRedactionSection: ComponentType<{ projectId: string; kind: WorkspaceKind }> | null
	ArtifactRedactionSection: ComponentType<{ artifactId: string }> | null
	ViewAsAiSection: ComponentType<{ revisionId: string }> | null
	/** "Redaction for this Connection" and its three modes, in the Connection dialog and drawer. */
	ConnectionRedactionPicker: ComponentType<{ connection: Connection; variant: Variant }> | null
	/** Whether the General access menu offers `org`, everyone at the Workspace. */
	generalAccessOrg: boolean
	/** Whether an Admin's Invite offers the Admin role as well as Member. */
	adminInvites: boolean
	/** Whether a Connection's Revision is checked for sensitive values before it can be approved; names its wait. */
	redactionCheck: boolean
	/** Whether an Invited row offers its `?invited=1` link to copy; otherwise it says a Join Link is needed. */
	useInviteLinkCopyable: () => boolean
	/** The "Open in the app" banner on mobile Artifact and folder pages. */
	OpenInAppBanner: ComponentType<{ offered?: boolean }> | null
	/** "Open in Mac app" menu items. A plain function: LibraryScreen calls it inside a row map. */
	openInAppItems(path: string, onSelect: () => void): MenuItem[]
	/** Whether a single click on a file opens it in a Mac app tab. Read at click time, not a hook. */
	clickOpensTab(): boolean
	/** The rows of Settings → General's "Mac app" card, shown only inside the Mac app; null leaves the card out. */
	MacAppSettings: ComponentType | null
	/** The sign-in card's "Download desktop app" link; null leaves it out. */
	DesktopAppLink: ComponentType | null
	/** Inside the Mac app, the server this sign-in is for and a way to change it; null leaves it out. */
	ServerFooter: ComponentType | null
	/** The Team page's joining settings, called unconditionally by the Team page and the mobile Invites block. */
	useTeamJoining(): TeamJoining
	/** Join Requests and Seats for the desktop Team page; `admin` gates the Join Request list. */
	useTeamRequests(admin: boolean): TeamRequests
	/** The same for the mobile Team page, with the mobile Join Request section. */
	useTeamRequestsMobile(admin: boolean): TeamRequests
	/**
	 * The role a new share in the session's Team starts at, undefined until known; `enabled` is false for any other
	 * Workspace. An edition with Joining settings reads the Team's; otherwise it is the column's fixed default.
	 */
	useTeamDefaultShareRole(enabled: boolean): GrantRole | undefined
	/** Called unconditionally at the top of `useArtifactActions`, before its `artifact === null` return. */
	useEditionArtifactActions(artifact: VisibleArtifact | null): EditionArtifactActions
	/** Pins: pinning a file to the sidebar, kept in this browser only. False leaves every pin control and list out. */
	pins: boolean
	/** Tags on a file, kept in this browser only. False leaves the ⋯ menu's Tags out. */
	tags: boolean
	/**
	 * A folder's written Policy (with "Draft with AI") and overwrite switch, kept in this browser only. False leaves
	 * them out everywhere; a Team folder's rules then show only its Published version, and a Personal folder has none.
	 */
	projectRules: boolean
	/**
	 * Whether the sign-in card and Settings follow the install's providers answer: a lone password form gets a heading,
	 * and Settings lists Google only where the install has it or the account already holds one. False always hides that
	 * heading and always lists Google.
	 */
	followsProviders: boolean
	/** Audit's sample token counts and cost, which the API does not record. False leaves them out. */
	auditCost: boolean
	/** The weekly recap's stand-in for an empty library; null shows the empty week. */
	recapSample: RecapSample | null
	/**
	 * Where the Connections page's "Learn more" goes: the connector docs' URL, `"unpublished"` to say they are not out
	 * yet, or null to leave the button out.
	 */
	connectorDocs: { url: string } | "unpublished" | null
	/** The muted line under the wordmark for the session's Workspace, empty until the kind is known; null hides it. */
	accountLine(kind: WorkspaceKind | undefined, workspaceName: string | undefined): string | null
	/** Called unconditionally by the sign-in card's first step; null where no sign-in email is sent. */
	useEmailSignInSend: () => EmailSignInSend | null
	emailSignIn: EmailSignIn | null
	copy: EditionCopy
}
