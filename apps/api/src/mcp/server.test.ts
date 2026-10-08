import { TOOL_ANNOTATIONS, TOOL_NAMES } from "@exagram/mcp"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it } from "vitest"

import { buildMcpServer } from "./server"

describe("buildMcpServer tools/list", () => {
	it("advertises the registry's annotations on every tool", async () => {
		const server = buildMcpServer({
			principal: { kind: "connection", id: "c1", folderAccess: "all" },
			scopes: ["read"],
			usecase: {} as never,
			redactionEnabled: true,
		})
		const client = new Client({ name: "test", version: "0.0.0" })
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
		await Promise.all([server.connect(serverSide), client.connect(clientSide)])

		const { tools } = await client.listTools()
		expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES])
		for (const tool of tools) {
			expect(tool.annotations).toEqual(TOOL_ANNOTATIONS[tool.name as (typeof TOOL_NAMES)[number]])
		}
		expect(tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name)).toEqual([
			"artifact_list",
			"artifact_search",
			"artifact_read",
			"project_list",
		])

		await client.close()
		await server.close()
	})
	it.each([
		[true, true],
		[false, false],
	])("with redaction %s, the artifact_upload description names redaction: %s", async (redactionEnabled, mentioned) => {
		const server = buildMcpServer({
			principal: { kind: "connection", id: "c1", folderAccess: "all" },
			scopes: ["write"],
			usecase: {} as never,
			redactionEnabled,
		})
		const client = new Client({ name: "test", version: "0.0.0" })
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
		await Promise.all([server.connect(serverSide), client.connect(clientSide)])

		const { tools } = await client.listTools()
		const description = tools.find((tool) => tool.name === "artifact_upload")!.description!
		expect(/redact/i.test(description)).toBe(mentioned)
		expect(description).toContain("placeholder such as [EMAIL]")

		await client.close()
		await server.close()
	})
})
