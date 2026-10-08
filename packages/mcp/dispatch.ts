import { RefusalError } from "@exagram/core/utils/refusal"
import { z } from "zod"

import { BinaryImageReadError, type ToolContext, type ToolResult, type ToolTable, text } from "./port"
import { TOOL_SCOPES, type Scope } from "./registry"
import { isToolName, NARROWED_REFUSAL_TEXT, REFUSAL_TEXT, scopeDenialMessage } from "./scopes"
import { artifactList } from "./tools/artifact-list.tool"
import { artifactRead } from "./tools/artifact-read.tool"
import { artifactSearch } from "./tools/artifact-search.tool"
import { artifactUploadComplete } from "./tools/artifact-upload-complete.tool"
import { artifactUploadUrl } from "./tools/artifact-upload-url.tool"
import { artifactUpload } from "./tools/artifact-upload.tool"
import { grantRemove } from "./tools/grant-remove.tool"
import { grantUpdateRole } from "./tools/grant-update-role.tool"
import { projectList } from "./tools/project-list.tool"

export const TOOL_TABLE: ToolTable = {
	artifact_list: artifactList,
	artifact_search: artifactSearch,
	artifact_read: artifactRead,
	artifact_upload: artifactUpload,
	artifact_upload_url: artifactUploadUrl,
	artifact_upload_complete: artifactUploadComplete,
	project_list: projectList,
	grant_remove: grantRemove,
	grant_update_role: grantUpdateRole,
}

export async function dispatchTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolResult> {
	if (!isToolName(name)) {
		return text(`Refused: "${name}" is not a tool on this server. Call tools/list to see the nine that are.`, true)
	}

	const required: Scope = TOOL_SCOPES[name]
	if (!ctx.scopes.includes(required)) {
		return text(scopeDenialMessage(name, required), true)
	}

	try {
		return await TOOL_TABLE[name](ctx, (input ?? {}) as Record<string, unknown>)
	} catch (error) {
		// The message of a throw can name a row, a column or a constraint, so it is logged here and
		// never sent. Only three things go back: a schema failure, which the model can fix; the one
		// refusal sentence, which says nothing about whether the id exists; and a bare failure.
		ctx.log?.({ tool: name, error })
		if (error instanceof z.ZodError) {
			return text(`Refused: the arguments to "${name}" did not match its input schema.`, true)
		}
		if (error instanceof BinaryImageReadError)
			return text(ctx.principal.folderAccess === "named" ? NARROWED_REFUSAL_TEXT : error.message, true)
		if (error instanceof RefusalError)
			return text(ctx.principal.folderAccess === "named" ? NARROWED_REFUSAL_TEXT : REFUSAL_TEXT, true)
		return text(`Refused: "${name}" failed. Nothing was read or written.`, true)
	}
}
