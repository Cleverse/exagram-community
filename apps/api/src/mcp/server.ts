import {
	dispatchTool,
	TOOL_ANNOTATIONS,
	TOOL_INPUTS,
	TOOL_NAMES,
	toolDescriptions,
	type ToolContext,
} from "@exagram/mcp"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

type ServerContext = ToolContext & {
	/** Off keeps redaction out of the tool descriptions AI clients read. */
	redactionEnabled: boolean
	beginCall?: () => void
	stampEmitted?: (payload: string) => Promise<void>
}

/**
 * Schemas are authored in zod beside the contracts and converted here, so the SDK's own zod
 * version never constrains ours and a transport swap does not touch a tool file.
 */
function inputSchemaFor(name: (typeof TOOL_NAMES)[number]) {
	return z.toJSONSchema(z.object(TOOL_INPUTS[name]).strict(), { target: "draft-7" })
}

export function buildMcpServer(ctx: ServerContext): Server {
	const descriptions = toolDescriptions(ctx.redactionEnabled)
	const server = new Server({ name: "exagram", version: "1.0.0" }, { capabilities: { tools: { listChanged: false } } })

	// The full table is advertised to every Connection: varying it by granted scope would make the
	// list a lie, and the refusal already names the missing scope.
	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: TOOL_NAMES.map((name) => ({
			name,
			description: descriptions[name],
			inputSchema: inputSchemaFor(name),
			annotations: TOOL_ANNOTATIONS[name],
		})),
	}))

	// The SDK's CallToolResult schema also covers an async-task result variant this server never
	// returns, so ToolResult, the plain synchronous shape, is cast rather than widened to match it.
	server.setRequestHandler(CallToolRequestSchema, async (requestPayload): Promise<CallToolResult> => {
		ctx.beginCall?.()
		const result = await dispatchTool(ctx, requestPayload.params.name, requestPayload.params.arguments ?? {})
		await ctx.stampEmitted?.(result.content.map((part) => part.text).join("\n"))
		return result as CallToolResult
	})

	return server
}
