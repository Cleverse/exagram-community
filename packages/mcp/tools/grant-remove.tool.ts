import { type ToolContext, type ToolResult, text } from "../port"
import { parseToolInput } from "../registry"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "../scopes"

export async function grantRemove(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
	const args = parseToolInput("grant_remove", input) as { grant_id: string }
	const { result: removed } = await ctx.usecase.removeGrant(ctx.principal, args.grant_id)
	if (!removed) {
		const refusal =
			ctx.principal.folderAccess === "named" ? NARROWED_REFUSAL_TEXT.replace("artifact", "grant") : REFUSAL_TEXT
		return text(`${refusal} NOTHING was changed.`, true)
	}
	return text(
		`Removed grant ${removed.grantId} from artifact ${removed.artifactId}. That person can no longer read it; no Link they hold is affected, and Links are revoked in the web app.`,
	)
}
