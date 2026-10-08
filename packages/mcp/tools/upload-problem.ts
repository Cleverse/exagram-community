import { type ToolContext, type ToolResult, type UploadProblem, text } from "../port"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"

export function uploadRefusal(ctx: ToolContext): ToolResult {
	return text(
		`${ctx.principal.folderAccess === "named" ? NARROWED_REFUSAL_TEXT : REFUSAL_TEXT} NOTHING was written.`,
		true,
	)
}

const sentence = (problem: UploadProblem): string => {
	switch (problem.code) {
		case "project-required":
			return "a new Artifact needs project_id; to add a Revision to an existing one, pass artifact_id."
		case "mime-required":
			return `kind ${problem.kind} needs mime, one of: ${problem.allowed.join(", ")}.`
		case "mime-not-allowed":
			return `kind ${problem.kind} does not accept mime ${problem.mime}; use one of: ${problem.allowed.join(", ")}.`
		case "too-large":
			return `a kind ${problem.kind} upload may be at most ${problem.maxBytes} bytes.`
		case "foreign-upload-id":
			return "that upload_id does not belong to this Artifact."
		case "no-object":
			return "no uploaded file was found for that upload_id. If the PUT succeeded, call artifact_upload_complete again; otherwise PUT the file to the URL artifact_upload_url gave you, or call artifact_upload_url again if it expired."
		case "checksum-mismatch":
			return "the uploaded file does not match the sha256 you declared."
		case "stored-mime-not-allowed":
			return `the uploaded file's content-type is not one kind ${problem.kind} accepts.`
	}
}

export function uploadProblem(problem: UploadProblem): ToolResult {
	return text(`Refused: ${sentence(problem)} NOTHING was written.`, true)
}
