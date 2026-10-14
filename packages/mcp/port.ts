import { type Scope, type ToolName } from "./registry"

/** The only principal an MCP tool ever runs as. */
export interface ConnectionPrincipal {
	kind: "connection"
	id: string
	folderAccess: "all" | "named"
}

export interface ArtifactSummary {
	artifactId: string
	kind: string
	title: string
	projectId: string | null
	revisionId: string | null
	form: ArtifactForm
}

export interface ProjectSummary {
	projectId: string
	name: string
	parentProjectId: string | null
	access: "owner" | "edit" | "collaborate" | "view"
}

export type RevisionSelector = number | "latest"
export type ArtifactForm = "original" | "redacted" | null

export interface ArtifactBody {
	artifactId: string
	/** The Revision the boundary resolved, so the ledger row can name what was actually delivered. */
	revisionId: string
	title: string
	kind: string
	seq: number
	status: "approved" | "pending" | "discarded"
	body: string
	form: Exclude<ArtifactForm, null>
	detectorVersion: number | null
}

/** Only the Ledger sees this; the caller's refusal text is the same whichever it is. */
export type RefusalReason =
	| "redaction-unavailable"
	| "out-of-boundary"
	| "outside-connection-folders"
	| "refused-in-serve"

export type ArtifactReadResult = { artifact: ArtifactBody; reason: null } | { artifact: null; reason: RefusalReason }

export const BINARY_IMAGE_READ_REFUSAL = "This is a binary image and is not readable as text."

export class BinaryImageReadError extends Error {
	constructor() {
		super(BINARY_IMAGE_READ_REFUSAL)
		this.name = "BinaryImageReadError"
	}
}

export interface ArtifactSearchHit extends ArtifactSummary {
	/** `ts_headline` over the served form of the resolved Revision, `<<`/`>>` marked. */
	snippet: string
	detectorVersion: number | null
}

export interface UploadResult {
	artifactId: string
	revisionId: string
	seq: number
	/** "approved" when it published on arrival under the 'auto' Publish Policy. */
	status: "approved" | "pending"
}

export type MutationResult<T> = { result: T; reason: null } | { result: null; reason: RefusalReason }

export interface UploadUrlResult {
	artifactId: string
	/** True when this call created the Artifact; it exists, empty, until a Revision is completed. */
	created: boolean
	/** The storage key; artifact_upload_complete takes it back. */
	uploadId: string
	url: string
	expiresInSeconds: number
	requiredHeaders: Record<string, string>
}

export interface UploadCompleteResult {
	artifactId: string
	revisionId: string
	seq: number
	kind: string
	status: "approved" | "pending" | "discarded"
	extractionStatus: string
	/** True when an earlier call already wrote this Revision from the same upload_id. */
	repeated: boolean
	/**
	 * Set by the ledger wrapper when a job could not be queued after commit. A repeat re-queues only a
	 * parse, so only "parse-not-queued" is the caller's to retry; a lost redaction job is the sweep's.
	 */
	processingProblem?: "parse-not-queued" | "redaction-not-queued"
}

/**
 * A mistake the calling model can fix. Each is decided from its own arguments, or only after the
 * boundary admitted the Artifact, so none says anything about an Artifact the caller cannot reach.
 */
export type UploadProblem =
	| { code: "project-required" }
	| { code: "mime-required"; kind: string; allowed: string[] }
	| { code: "mime-not-allowed"; kind: string; mime: string; allowed: string[] }
	| { code: "too-large"; kind: string; maxBytes: number }
	| { code: "foreign-upload-id" }
	| { code: "no-object" }
	| { code: "checksum-mismatch" }
	| { code: "stored-mime-not-allowed"; kind: string }

export type UploadOutcome<T> = MutationResult<T> | { result: null; reason: null; problem: UploadProblem }

export interface GrantChange {
	grantId: string
	artifactId: string
	role?: string
}

/**
 * Implemented in apps/api. Nothing in packages/mcp opens a socket, a pool or a transport; a tool
 * is a schema plus a call on this port.
 */
export interface McpToolUsecase {
	listArtifacts(
		principal: ConnectionPrincipal,
		input: { projectId?: string; kind?: string; limit: number },
	): Promise<ArtifactSummary[]>
	searchArtifacts(
		principal: ConnectionPrincipal,
		input: { query: string; projectId?: string; limit: number },
	): Promise<ArtifactSearchHit[]>
	readArtifact(
		principal: ConnectionPrincipal,
		artifactId: string,
		revision?: RevisionSelector,
	): Promise<ArtifactReadResult>
	listProjects(principal: ConnectionPrincipal): Promise<ProjectSummary[]>
	upload(
		principal: ConnectionPrincipal,
		input: { projectId: string; kind: string; title: string; content: string; artifactId?: string; note?: string },
	): Promise<MutationResult<UploadResult>>
	createUploadUrl(
		principal: ConnectionPrincipal,
		input: { projectId?: string; kind: string; title: string; bytes: number; mime?: string; artifactId?: string },
	): Promise<UploadOutcome<UploadUrlResult>>
	completeUpload(
		principal: ConnectionPrincipal,
		input: { artifactId: string; uploadId: string; sha256: string; note?: string },
	): Promise<UploadOutcome<UploadCompleteResult>>
	removeGrant(principal: ConnectionPrincipal, grantId: string): Promise<MutationResult<GrantChange>>
	updateGrantRole(principal: ConnectionPrincipal, grantId: string, role: string): Promise<MutationResult<GrantChange>>
}

export interface ToolContext {
	principal: ConnectionPrincipal
	scopes: readonly Scope[]
	usecase: McpToolUsecase
	/** The web app's origin, no trailing slash; a write names the page it lands on under it. */
	webOrigin?: string
	/** Where a thrown error goes. It is never put in a tool result: the model is not an operator. */
	log?: (event: { tool: string; error: unknown }) => void
}

export interface ToolResult {
	content: { type: "text"; text: string }[]
	isError?: true
}

export type ToolHandler = (ctx: ToolContext, input: Record<string, unknown>) => Promise<ToolResult>

export type ToolTable = Record<ToolName, ToolHandler>

export function text(value: string, isError = false): ToolResult {
	return { content: [{ type: "text", text: value }], ...(isError ? { isError: true as const } : {}) }
}
