import { type ToolContext, type ToolResult, text } from "../port"
import { parseToolInput } from "../registry"

export async function projectList(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
	parseToolInput("project_list", input)
	const projects = await ctx.usecase.listProjects(ctx.principal)
	if (projects.length === 0) {
		return text(
			ctx.principal.folderAccess === "named"
				? "This client is limited to folders its person chose; files outside them are not listed.\nNo Project is available to this client under the selected folders."
				: "This Connection's person owns no Project and holds no Grant on one.",
		)
	}
	const lines = projects.map(
		(project) =>
			`${project.projectId}\t${project.name}\tparent=${project.parentProjectId ?? "-"}\taccess=${project.access}`,
	)
	return text(
		[
			...(ctx.principal.folderAccess === "named"
				? ["This client is limited to folders its person chose; files outside them are not listed."]
				: []),
			`${projects.length} project(s), id / name / parent / access:`,
			...lines,
		].join("\n"),
	)
}
