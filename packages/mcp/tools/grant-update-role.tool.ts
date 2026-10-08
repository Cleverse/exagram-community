import { type ToolContext, type ToolResult, text } from "../port"
import { parseToolInput } from "../registry"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"

export async function grantUpdateRole(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
	const args = parseToolInput("grant_update_role", input) as { grant_id: string; role: string }
	const { result: updated } = await ctx.usecase.updateGrantRole(ctx.principal, args.grant_id, args.role)
	if (!updated) {
		const refusal =
			ctx.principal.folderAccess === "named" ? NARROWED_REFUSAL_TEXT.replace("artifact", "grant") : REFUSAL_TEXT
		return text(`${refusal} NOTHING was changed.`, true)
	}
	return text(
		`Grant ${updated.grantId} on artifact ${updated.artifactId} is now ${updated.role}. A Pin is unchanged: no tool can set or clear one.`,
	)
}
