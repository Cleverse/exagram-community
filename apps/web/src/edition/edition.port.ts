import type { Connection, VisibleArtifact, WorkspaceKind } from "@exagram/api-client"

import type { MenuItem } from "@/components/ui/Menu"
import type { RecapFile, RecapProject } from "@/features/context/recap"
import type { OrgAccessCopy } from "@/features/grants/general-access/generalAccess"
import type { SettingsTab } from "@/routes/paths"
import type { ComponentType, ReactNode } from "react"
import type { RouteObject } from "react-router"

export type Variant = "desktop" | "mobile"

/** What a Workspace-aware sign-up adds to the body. Community adds nothing, so the key stays absent. */
export type SignUpWorkspaceInput = { workspaceName: string }

export interface ArtifactEeActions {
	items: MenuItem[]
	dialogs: ReactNode
}

/** Sentences that name the Workspace in Cloud. Community's never say "Workspace" or its name (P29). */
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
	/** The General Access `org` choice's sentences; Community's describe a stored one without naming the Workspace. */
	generalAccessOrg: OrgAccessCopy
	/** Google error codes only Cloud raises, by code; empty in Community. */
	googleErrors: Readonly<Record<string, string>>
	/** The Team page's remove button: its tooltip, and its label for a screen reader (P82). */
	removeMemberTitle: string
	removeMemberLabel(memberName: string): string
	/** The confirm dialog when an Admin demotes themself (P82). */
	demoteYourself: string
	/** The toast when an Invite is refused because the caller may no longer invite (P82). */
	inviteRefused: string
	/** Settings → General's subline under its heading. */
	generalSubline: string
	/** The summary of a Revision's provenance in History. */
	provenanceSummary: string
}

/** The joining settings the Team page and the mobile Invites block read. Community's are fixed (P79). */
export interface TeamJoining {
	ready: boolean
	emailed: boolean
	domain: string | null
	memberInvites: boolean
	error: Error | null
}

/** Join Requests and the Seat count, which only the desktop Team page shows (P79). */
export interface TeamRequests {
	count: number
	section: ReactNode
	seatsLine: string | null
	errors: readonly (Error | null)[]
}

/** The design's sample week, which the weekly recap shows while the library has loaded empty. */
export interface RecapSample {
	files(): RecapFile[]
	projects(): RecapProject[]
}

/** Whether redaction is on in the session's Workspace; "loading" until it is known. */
export type RedactionCapability = "loading" | "enabled" | "disabled"

export interface EditionModule {
	/** Routes outside the app frame (email confirmation, unsubscribe). */
	publicRoutes: RouteObject[]
	/** Settings tabs only this edition has, with their desktop and mobile page. */
	settingsPages: Partial<Record<SettingsTab, { desktop: ComponentType; mobile: ComponentType }>>
	/** The Workspace card (name and ID) in Settings → General. */
	WorkspaceSection: ComponentType<{ variant: Variant }> | null
	/** The Admin's Notification Email settings in Settings → General. */
	WorkspaceNotificationEmailSettings: ComponentType<{ variant: Variant }> | null
	/** A member's own email address and cadence in Settings → Notifications. */
	NotificationEmailSettings: ComponentType<{ variant: Variant }> | null
	/**
	 * Gates every redaction control and the Security tab. Fails closed: an error reads "disabled". Community has no
	 * redaction and never asks.
	 */
	useRedactionCapability: () => RedactionCapability
	ProjectRedactionSection: ComponentType<{ projectId: string; kind: WorkspaceKind }> | null
	ArtifactRedactionSection: ComponentType<{ artifactId: string }> | null
	ViewAsAiSection: ComponentType<{ revisionId: string }> | null
	/** "Redaction for this client" and its three modes, in the Connection dialog and drawer. */
	ConnectionRedactionPicker: ComponentType<{ connection: Connection; variant: Variant }> | null
	SignUpWorkspaceFields: ComponentType<{
		value: SignUpWorkspaceInput
		onChange(value: SignUpWorkspaceInput): void
	}> | null
	/** Google sign-up with its Workspace sentence; null renders the plain Google button. */
	SignUpGoogle: ComponentType | null
	/** Whether the General access menu offers `org`, everyone at the Workspace (ADR 0027). */
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
	/** Whether a single click on a file opens it in a Mac app tab (P80). Read at click time, not a hook. */
	clickOpensTab(): boolean
	/** The rows of Settings → General's "Mac app" card, shown only inside the Mac app (P80). */
	MacAppSettings: ComponentType | null
	/** The Team page's joining settings, called unconditionally by the Team page and the mobile Invites block (P79). */
	useTeamJoining(): TeamJoining
	/** Join Requests and Seats for the desktop Team page; `admin` gates the Join Request list (P79). */
	useTeamRequests(admin: boolean): TeamRequests
	/** Called unconditionally at the top of `useArtifactActions`, before its `artifact === null` return. */
	useArtifactEeActions(artifact: VisibleArtifact | null): ArtifactEeActions
	/** The weekly recap's stand-in for an empty library; null shows the empty week. */
	recapSample: RecapSample | null
	/** The muted line under the wordmark for the session's Workspace; null hides it. */
	accountLine(kind: WorkspaceKind, workspaceName: string | undefined): string | null
	copy: EditionCopy
}
