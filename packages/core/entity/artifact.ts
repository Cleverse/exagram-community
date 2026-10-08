import type { Access } from "./principal"
import type { ExtractionStatus } from "./revision"

export type ArtifactKind = "doc" | "html" | "chat" | "pdf" | "docx" | "pptx" | "xlsx" | "image"
export type DefaultPin = "latest" | "current"
/** 'auto' publishes an Owner's or Editor's upload on arrival; 'manual' holds every upload for the Owner. */
export type PublishPolicy = "auto" | "manual"
/** Restricted (Grants only), everyone on the Workspace's Allowed Domain, or anyone with the link (ADR 0027, 0042). */
export type GeneralAccess = "restricted" | "org" | "anyone"

/**
 * Why a reader of an Artifact open to Anyone with the link was turned away with an answer and not a refusal
 * (ADR 0044): its Owner requires a password they have not entered, or the address has expired.
 */
export type AnyoneGate = "password" | "expired"

/** What the Owner chose for Anyone with the link, beyond who it admits. The password hash is never in it. */
export interface AnyoneSettings {
	passwordOn: boolean
	/** A password is stored, so it can be switched back on without typing one. */
	passwordSet: boolean
	expiresAt: Date | null
	download: boolean
}

/** A settings change leaves alone any field it omits. `expiresAt: null` clears the expiry. */
export interface AnyoneSettingsPatch {
	passwordOn?: boolean
	/** An argon2id hash of the new password, never the password. */
	passwordHash?: string
	expiresAt?: Date | null
	download?: boolean
}

export const EXTRACTED_KINDS: ReadonlySet<ArtifactKind> = new Set(["pdf", "docx", "pptx", "xlsx"])
export const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/heic",
	"image/heif",
])

/** What an upload ticket may declare as `mime`, keyed by the artifact's own kind. */
export const ALLOWED_MIME_TYPES: Readonly<Record<ArtifactKind, ReadonlySet<string>>> = {
	doc: new Set(["text/markdown", "text/plain", "text/csv"]),
	html: new Set(["text/html"]),
	chat: new Set(["application/json", "text/plain"]),
	pdf: new Set(["application/pdf"]),
	docx: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
	pptx: new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation"]),
	xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
	image: IMAGE_MIME_TYPES,
}

export interface Artifact {
	id: string
	workspaceId: string
	ownerId: string
	projectId: string | null
	kind: ArtifactKind
	title: string
	sourceFilename?: string | null
	sourceDescription?: string | null
	currentRevisionId: string | null
	defaultPin: DefaultPin
	/** This Artifact's own choice; null follows its Project (or 'auto' outside any Project). */
	publishPolicy: PublishPolicy | null
	generalAccess: GeneralAccess
	deletedAt: Date | null
	createdAt: Date
}

export interface VisibleArtifactRow extends Artifact {
	workspaceName: string
	orgDomain: string | null
	/** The policy that actually governs uploads here, from exagram.effective_publish_policy. */
	effectivePublishPolicy: PublishPolicy
	visibleRevisionId: string | null
	access: Access
	/** The boundary's own answer, so nothing above it compares two revision ids to guess. */
	pinned: boolean
	revisionSeq: number | null
	/** The visible Revision's text extraction; null with no visible Revision. `queued` is still indexing. */
	extractionStatus: ExtractionStatus | null
	updatedAt: Date
	ownerName: string
	sharedCount: number
	sharedWithNames: string[]
	/** The boundary's answer: false only for a reader Anyone with the link admits while its Owner withheld download. */
	canDownload: boolean
	anyoneSettings: AnyoneSettings
}

/**
 * What a reader is allowed to know. Telling a pinned grantee that a newer Revision exists is the
 * leak the pin exists to prevent, so `currentRevisionId` reaches an owner and nobody else. The
 * password, expiry and download choices are the Owner's alone.
 */
export interface ReadableArtifact extends Omit<VisibleArtifactRow, "currentRevisionId" | "pinned" | "anyoneSettings"> {
	currentRevisionId?: string | null
	isPinned: boolean
	anyoneSettings: AnyoneSettings | null
}

export const forReader = (row: VisibleArtifactRow): ReadableArtifact => {
	const { pinned, currentRevisionId, anyoneSettings, ...rest } = row
	return {
		...rest,
		...(row.access === "owner" ? { currentRevisionId } : {}),
		isPinned: pinned,
		anyoneSettings: row.access === "owner" ? anyoneSettings : null,
	}
}

export interface NewArtifact {
	workspaceId: string
	ownerId: string
	projectId: string | null
	kind: ArtifactKind
	title: string
}
