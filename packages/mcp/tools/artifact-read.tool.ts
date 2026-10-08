import { type ToolContext, type ToolResult, text } from "../port"
import { parseToolInput } from "../registry"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"
import { wrapUntrusted } from "../untrusted"

export async function artifactRead(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
	const args = parseToolInput("artifact_read", input) as { artifact_id: string; revision?: number | "latest" }
	const { artifact } = await ctx.usecase.readArtifact(ctx.principal, args.artifact_id, args.revision)

	// Out of boundary, Withheld and nonexistent share one sentence: the response is the same
	// whichever it was, so no call can be used to test whether an id exists.
	if (!artifact) return text(ctx.principal.folderAccess === "named" ? NARROWED_REFUSAL_TEXT : REFUSAL_TEXT, true)

	return text(
		[
			`${artifact.title} (${artifact.kind}, Revision ${artifact.seq}, ${artifact.status})`,
			"",
			wrapUntrusted({ artifactId: artifact.artifactId, body: artifact.body }),
		].join("\n"),
	)
}
