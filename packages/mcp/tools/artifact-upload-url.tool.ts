import { type ToolContext, type ToolResult, text } from "../port"
import { parseToolInput } from "../registry"

import { uploadProblem, uploadRefusal } from "./upload-problem"

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

export async function artifactUploadUrl(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
	const args = parseToolInput("artifact_upload_url", input) as {
		project_id?: string
		artifact_id?: string
		kind: string
		title: string
		mime?: string
		bytes: number
	}

	const outcome = await ctx.usecase.createUploadUrl(ctx.principal, {
		...(args.project_id ? { projectId: args.project_id } : {}),
		kind: args.kind,
		title: args.title,
		bytes: args.bytes,
		...(args.mime ? { mime: args.mime } : {}),
		...(args.artifact_id ? { artifactId: args.artifact_id } : {}),
	})
	if (outcome.result === null) return outcome.reason === null ? uploadProblem(outcome.problem) : uploadRefusal(ctx)

	const ticket = outcome.result
	const headers = Object.entries(ticket.requiredHeaders)
	// curl -T sets content-length from the file itself.
	const curlHeaders = headers
		.filter(([name]) => name.toLowerCase() !== "content-length")
		.map(([name, value]) => `-H ${shellQuote(`${name}: ${value}`)}`)
	return text(
		[
			ticket.created
				? `Reserved Artifact ${ticket.artifactId}; it appears only once artifact_upload_complete succeeds.`
				: `Ready for a new Revision of Artifact ${ticket.artifactId}.`,
			`upload_id: ${ticket.uploadId}`,
			`PUT the file's bytes to this URL within ${ticket.expiresInSeconds} seconds:`,
			ticket.url,
			"Required headers:",
			...headers.map(([name, value]) => `${name}: ${value}`),
			"With curl:",
			["curl --fail -X PUT -T <path-to-file>", ...curlHeaders, shellQuote(ticket.url)].join(" "),
			`Then call artifact_upload_complete with artifact_id ${ticket.artifactId}, upload_id ${ticket.uploadId} and the file's sha256 (\`shasum -a 256 <file>\`).`,
		].join("\n"),
	)
}
