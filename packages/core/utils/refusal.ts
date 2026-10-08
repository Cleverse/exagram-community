import { NotFoundError } from "./errors"

/**
 * The one sentence every Artifact refusal says. Not-found, out-of-boundary and a Revision the
 * caller may not read all produce this exact byte string, on the human API, in every MCP tool and
 * on the Link page, so a caller can never tell them apart.
 */
export const REFUSAL_TEXT = "No artifact with that id is available."

export const NARROWED_REFUSAL_TEXT =
	"No artifact with that id is available to this client. This client is limited to folders its person chose; if the file is in another folder, its person can add it in Exagram → MCP."

/**
 * A `NotFoundError`, so the one `DomainError` branch in the API error mapper already answers 404 with
 * this message; the subclass exists so a caller can catch the refusal without matching on a string.
 */
export class RefusalError extends NotFoundError {
	constructor() {
		super(REFUSAL_TEXT)
		this.name = "RefusalError"
	}
}

export const WORKSPACE_REFUSAL_TEXT = "No workspace with that id is available."

export class WorkspaceRefusalError extends NotFoundError {
	constructor() {
		super(WORKSPACE_REFUSAL_TEXT)
		this.name = "WorkspaceRefusalError"
	}
}

export class MemberRemovedError extends NotFoundError {
	constructor() {
		super(REFUSAL_TEXT)
		this.name = "MemberRemovedError"
	}
}
