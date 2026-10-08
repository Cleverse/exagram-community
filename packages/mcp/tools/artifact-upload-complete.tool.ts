import { type ToolContext, type ToolResult, text } from "../port"
import { parseToolInput, WRITABLE_KINDS } from "../registry"

import { uploadProblem, uploadRefusal } from "./upload-problem"

const STATUS_TEXT = {
	approved: "It is published: its Publish Policy is automatic, so it is already the Current Revision.",
	pending: "It is Pending: the Owner must approve it before it becomes the Current Revision.",
	discarded: "It is Discarded: the Owner turned it down.",
} as const

const PROCESSING_TEXT = {
	"parse-not-queued": "Parsing could not be queued; call artifact_upload_complete again with the same arguments.",
	"redaction-not-queued": "Some processing could not be queued yet; it will be retried automatically.",
} as const

const readBack = (kind: string) =>
	(WRITABLE_KINDS as readonly string[]).includes(kind)
		? `This Connection can read it back with artifact_read and revision "latest".`
		: kind === "image"
			? "An image is not readable as text."
			: "Its Extracted Text is readable with artifact_read once parsing finishes."

export async function artifactUploadComplete(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
	const args = parseToolInput("artifact_upload_complete", input) as {
		artifact_id: string
		upload_id: string
		sha256: string
		note?: string
	}

	const outcome = await ctx.usecase.completeUpload(ctx.principal, {
		artifactId: args.artifact_id,
		uploadId: args.upload_id,
		sha256: args.sha256,
		...(args.note ? { note: args.note } : {}),
	})
	if (outcome.result === null) return outcome.reason === null ? uploadProblem(outcome.problem) : uploadRefusal(ctx)

	const done = outcome.result
	return text(
		[
			`Wrote Revision ${done.seq} of Artifact ${done.artifactId}.`,
			STATUS_TEXT[done.status],
			readBack(done.kind),
			...(done.processingProblem ? [PROCESSING_TEXT[done.processingProblem]] : []),
			...(ctx.webOrigin ? [`Open it at ${ctx.webOrigin}/artifacts/${done.artifactId}`] : []),
		].join(" "),
	)
}
