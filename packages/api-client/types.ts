import { type coreContract } from "@exagram/core/contract"
import { type InferContractRouterOutputs } from "@orpc/contract"

import { type Unwrapped } from "./utils/result"

type Out = InferContractRouterOutputs<typeof coreContract>

/**
 * Every view type is read off the contract, so a field renamed in `packages/core/contract` breaks
 * the build here instead of rendering blank in the browser.
 *
 * Timestamps are the one place the inferred type is looser than the wire: the contract types them
 * `Date`, and JSON delivers ISO strings. Render them through `formatWhen`, never with `.getTime()`.
 */
export type SessionUser = Unwrapped<Out["auth"]["signIn"]>
/** The session user acting in one Workspace: its name and kind, and every Workspace the person can switch to. */
export type Me = Unwrapped<Out["auth"]["me"]>
export type WorkspaceKind = Me["workspaceKind"]
/** What the install offers before sign-in: Google, and whether AI edit is on. */
export type AuthProviders = Unwrapped<Out["auth"]["providers"]>
export type Project = Unwrapped<Out["projects"]["create"]>
/** A listed Project: `Project` plus its Owner's name and everyone else who reaches it. */
export type VisibleProject = Unwrapped<Out["projects"]["list"]>["items"][number]
export type VisibleArtifact = Unwrapped<Out["artifacts"]["list"]>["items"][number]
export type ArtifactSearchHit = Unwrapped<Out["artifacts"]["search"]>["items"][number]
export type CreatedArtifact = Unwrapped<Out["artifacts"]["create"]>
export type UploadTicket = CreatedArtifact["ticket"]
export type DuplicatedArtifact = Unwrapped<Out["artifacts"]["duplicate"]>
export type Revision = Unwrapped<Out["revisions"]["list"]>["items"][number]
export type RevisionText = Unwrapped<Out["revisions"]["text"]>
export type BodyToken = Unwrapped<Out["revisions"]["bodyToken"]>
export type PreviewToken = Unwrapped<Out["revisions"]["previewToken"]>
/** An Invite to the Workspace as an Admin lists it; never its token. */
export type WorkspaceInvite = Unwrapped<Out["workspace"]["listInvites"]>["items"][number]
/** A created or renewed Invite with its Join Link, which only this response carries. */
export type IssuedInvite = Unwrapped<Out["workspace"]["createInvite"]>
export type InvitePreview = Unwrapped<Out["auth"]["previewInvite"]>
/** An Admin's Invites, and whether this install lets them create Reset Links. */
export type WorkspaceInvites = Unwrapped<Out["workspace"]["listInvites"]>
/** The Team list: an Admin's carries `lastActiveAt` and counts per Member, a Member's does not. */
export type MemberList = Unwrapped<Out["workspace"]["listMembers"]>
export type Member = Unwrapped<Out["workspace"]["setMemberRole"]>
export type MemberRole = Member["role"]
/** A Reset Link, which only the response that created it carries. */
export type IssuedResetLink = Unwrapped<Out["workspace"]["createResetLink"]>
export type ResetLinkPreview = Unwrapped<Out["auth"]["previewResetLink"]>
export type PendingRevision = Unwrapped<Out["approvals"]["listPending"]>["items"][number]
export type FindingType = PendingRevision["placeholderTypes"][number]
export type Grant = Unwrapped<Out["grants"]["list"]>["items"][number]
export type CommentThread = Unwrapped<Out["comments"]["list"]>
export type Comment = CommentThread["items"][number]
export type ShareLink = Unwrapped<Out["links"]["list"]>["items"][number]
export type CreatedLink = Unwrapped<Out["links"]["create"]>
export type Connection = Unwrapped<Out["connections"]["list"]>["connections"][number]
export type ConnectionFolders = Unwrapped<Out["connections"]["folders"]>
export type LedgerPage = Unwrapped<Out["ledger"]["forArtifact"]>
export type LedgerEntry = LedgerPage["items"][number]
export type ActivityPage = Unwrapped<Out["ledger"]["activity"]>
export type ActivityEntry = ActivityPage["items"][number]
export type ArtifactViewer = Unwrapped<Out["ledger"]["viewers"]>["items"][number]
/** One signal on the live feed: which Artifact changed and how, never the content itself. */
export type LiveEvent = Out["events"]["subscribe"] extends AsyncIterable<infer E> ? E : never
export type LiveTopic = LiveEvent["topic"]

/** The Owner's password, expiry and download choices for Anyone with the link; null for every other reader. */
export type AnyoneSettings = NonNullable<VisibleArtifact["anyoneSettings"]>
/** The expiries `setAnyoneSettings` takes; `null` removes it. */
export type AnyoneExpiryDays = 1 | 7 | 30
/** One change to those choices: every field is optional, and an absent one stays as it is. */
export type AnyoneSettingsPatch = {
	passwordOn?: boolean
	/** Replaces the stored password. */
	password?: string
	/** `null` removes the expiry. */
	expiresInDays?: AnyoneExpiryDays | null
	download?: boolean
}
export type ArtifactKind = VisibleArtifact["kind"]
export type Access = VisibleArtifact["access"]
export type DefaultPin = VisibleArtifact["defaultPin"]
export type PublishPolicy = VisibleArtifact["effectivePublishPolicy"]
export type GeneralAccess = VisibleArtifact["generalAccess"]
export type LinkPreview = Project["linkPreview"]
export type RevisionStatus = Revision["status"]
export type GrantRole = Grant["role"]
/** An open request to read an Artifact the caller owns. */
export type AccessRequest = Unwrapped<Out["accessRequests"]["list"]>["items"][number]
/** What is new for the caller since a cursor, and the server's clock (ADR 0036, ADR 0040). */
export type NotificationList = Unwrapped<Out["notifications"]["list"]>
/**
 * Something new for the caller, as metadata only: never a comment body or Revision content. An `accessRequest` carries
 * the requester's note, to the Owner it was written to.
 */
export type Notification = NotificationList["items"][number]
export type NotificationKind = Notification["kind"]
/** The member's account-level Notification Preferences, with the defaults until they change them. */
export type NotificationPreferences = Unwrapped<Out["notifications"]["getPreferences"]>
export type NotificationRevisionScope = NotificationPreferences["revisionScope"]
export type QuietHours = NotificationPreferences["quietHours"]
export type InviteSuggestion = Unwrapped<Out["grants"]["suggestions"]>["items"][number]
export type LibraryScope = "all" | "sharedWithMe" | "mine"

/** A `Date`-typed field arrives as a string; both are accepted so callers never branch. */
export type Timestamp = Date | string
