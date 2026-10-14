import { type ToolContext, type ToolResult, text } from "../port"
import { parseToolInput } from "../registry"
import { wrapUntrusted } from "../untrusted"

export async function artifactSearch(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
	const args = parseToolInput("artifact_search", input) as {
		query: string
		project_id?: string
		limit?: number
	}

	const hits = await ctx.usecase.searchArtifacts(ctx.principal, {
		query: args.query,
		...(args.project_id ? { projectId: args.project_id } : {}),
		limit: args.limit ?? 20,
	})

	if (hits.length === 0) {
		return text(
			[
				...(ctx.principal.folderAccess === "named"
					? ["This client is limited to folders its person chose; files outside them are not listed."]
					: []),
				`Nothing this Connection reaches matches "${args.query}". Search covers Artifact titles and Extracted Text.`,
			].join("\n"),
		)
	}

	// One envelope per hit, each carrying its own artifact id: a single envelope around the whole
	// answer would let one document's text look like it came from another.
	return text(
		[
			...(ctx.principal.folderAccess === "named"
				? ["This client is limited to folders its person chose; files outside them are not listed."]
				: []),
			`${hits.length} match(es), best first. Read one in full with artifact_read.`,
			...hits.map((hit) =>
				wrapUntrusted({
					artifactId: hit.artifactId,
					body: `${hit.title} (${hit.kind}, project=${hit.projectId ?? "-"})\n${hit.snippet}`,
				}),
			),
		].join("\n\n"),
	)
}
