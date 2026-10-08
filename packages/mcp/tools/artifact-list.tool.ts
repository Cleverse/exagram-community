import { type ToolContext, type ToolResult, text } from "../port"
import { parseToolInput } from "../registry"

export async function artifactList(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
	const args = parseToolInput("artifact_list", input) as {
		project_id?: string
		kind?: string
		limit?: number
	}
	const artifacts = await ctx.usecase.listArtifacts(ctx.principal, {
		...(args.project_id ? { projectId: args.project_id } : {}),
		...(args.kind ? { kind: args.kind } : {}),
		limit: args.limit ?? 50,
	})

	if (artifacts.length === 0) {
		return text(
			ctx.principal.folderAccess === "named"
				? "This client is limited to folders its person chose; files outside them are not listed.\nNo Artifact is available to this client under that filter."
				: "No Artifact is available to this Connection under that filter. It reaches what its person owns or holds a Grant on in the Workspace it is bound to.",
		)
	}

	const lines = artifacts.map(
		(artifact) =>
			`${artifact.artifactId}\t${artifact.kind}\t${artifact.title}\tproject=${artifact.projectId ?? "-"}` +
			(artifact.revisionId === null ? `\tno Current Revision — read with revision "latest"` : ""),
	)
	return text(
		[
			...(ctx.principal.folderAccess === "named"
				? ["This client is limited to folders its person chose; files outside them are not listed."]
				: []),
			`${artifacts.length} artifact(s), id / kind / title / project:`,
			...lines,
		].join("\n"),
	)
}
