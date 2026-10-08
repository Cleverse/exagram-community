import { type ToolContext, type ToolResult, text } from "../port"
import { parseToolInput } from "../registry"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"

export async function artifactUpload(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
	const args = parseToolInput("artifact_upload", input) as {
		project_id: string
		kind: string
		title: string
		content: string
		artifact_id?: string
		note?: string
	}

	const { result: uploaded } = await ctx.usecase.upload(ctx.principal, {
		projectId: args.project_id,
		kind: args.kind,
		title: args.title,
		content: args.content,
		...(args.artifact_id ? { artifactId: args.artifact_id } : {}),
		...(args.note ? { note: args.note } : {}),
	})

	if (!uploaded)
		return text(
			`${ctx.principal.folderAccess === "named" ? NARROWED_REFUSAL_TEXT : REFUSAL_TEXT} NOTHING was written.`,
			true,
		)

	return text(
		[
			`Wrote Revision ${uploaded.seq} of Artifact ${uploaded.artifactId}.`,
			uploaded.status === "approved"
				? "It is published: its Publish Policy is automatic, so it is already the Current Revision."
				: "It is Pending: the Owner must approve it before it becomes the Current Revision.",
			`This Connection can read it back with artifact_read and revision "latest".`,
			...(ctx.webOrigin ? [`Open it at ${ctx.webOrigin}/artifacts/${uploaded.artifactId}`] : []),
		].join(" "),
	)
}
