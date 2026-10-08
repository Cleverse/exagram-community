import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { TOOL_ANNOTATIONS, TOOL_INPUTS, TOOL_NAMES, TOOL_SCOPES, toolDescriptions } from "../../registry"
import { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT, scopeDenialMessage } from "../../scopes"

describe("the tool table", () => {
	it("is exactly the nine tools, in order", () => {
		expect([...TOOL_NAMES]).toEqual([
			"artifact_list",
			"artifact_search",
			"artifact_read",
			"artifact_upload",
			"artifact_upload_url",
			"artifact_upload_complete",
			"project_list",
			"grant_remove",
			"grant_update_role",
		])
	})

	it("maps every tool to exactly one scope", () => {
		expect(TOOL_SCOPES).toEqual({
			artifact_list: "read",
			artifact_search: "read",
			artifact_read: "read",
			artifact_upload: "write",
			artifact_upload_url: "write",
			artifact_upload_complete: "write",
			project_list: "read",
			grant_remove: "manage",
			grant_update_role: "manage",
		})
		expect(Object.keys(TOOL_SCOPES).sort()).toEqual([...TOOL_NAMES].sort())
	})

	it("pins the write and manage sets by name, from both directions", () => {
		const byScope = (scope: string) => TOOL_NAMES.filter((name) => TOOL_SCOPES[name] === scope)
		expect(byScope("write")).toEqual(["artifact_upload", "artifact_upload_url", "artifact_upload_complete"])
		expect(byScope("manage")).toEqual(["grant_remove", "grant_update_role"])
		expect(byScope("read")).toEqual(["artifact_list", "artifact_search", "artifact_read", "project_list"])
	})

	it("gives every tool an input schema and a description", () => {
		for (const redactionEnabled of [true, false]) {
			const descriptions = toolDescriptions(redactionEnabled)
			for (const name of TOOL_NAMES) {
				expect(TOOL_INPUTS[name]).toBeDefined()
				expect(descriptions[name].length).toBeGreaterThan(20)
			}
		}
	})

	it("keeps the placeholder exception in artifact_upload but names redaction only while it is on", () => {
		expect(toolDescriptions(true).artifact_upload).toContain("redaction placeholder such as [EMAIL]")
		expect(toolDescriptions(false).artifact_upload).toContain("bracketed placeholder such as [EMAIL]")
		expect(toolDescriptions(false).artifact_upload).not.toMatch(/redact/i)
		expect(toolDescriptions(true).artifact_upload_complete).toContain("redaction placeholder such as [EMAIL]")
		expect(toolDescriptions(false).artifact_upload_complete).toContain("bracketed placeholder such as [EMAIL]")
		expect(toolDescriptions(false).artifact_upload_complete).not.toMatch(/redact/i)
		expect(toolDescriptions(false).artifact_upload_url).not.toMatch(/redact/i)
	})

	it("marks exactly the read-scope tools read-only, and every tool closed-world", () => {
		for (const name of TOOL_NAMES) {
			expect(TOOL_ANNOTATIONS[name].readOnlyHint).toBe(TOOL_SCOPES[name] === "read")
			expect(TOOL_ANNOTATIONS[name].openWorldHint).toBe(false)
		}
		expect(TOOL_NAMES.filter((name) => TOOL_ANNOTATIONS[name].destructiveHint)).toEqual(["grant_remove"])
	})

	it("names the missing scope in a refusal and claims nothing was changed", () => {
		const message = scopeDenialMessage("artifact_upload", "write")
		expect(message).toContain('"artifact_upload"')
		expect(message).toContain("write")
		expect(message).toContain("Nothing was created, changed or removed.")
	})

	it("keeps one not-found sentence for every boundary refusal", () => {
		expect(REFUSAL_TEXT).toBe("No artifact with that id is available.")
		expect(NARROWED_REFUSAL_TEXT).toBe(
			"No artifact with that id is available to this client. This client is limited to folders its person chose; if the file is in another folder, its person can add it in Exagram → MCP.",
		)
	})

	it("imports no transport: the swap of MCP SDK stays a mount-point change", () => {
		const root = join(import.meta.dirname, "../..")
		const ts = (dir: string) =>
			readdirSync(dir)
				.filter((name) => name.endsWith(".ts"))
				.map((name) => join(dir, name))
		const files = [...ts(root), ...ts(join(root, "tools"))]
		for (const file of files) {
			expect(readFileSync(file, "utf8")).not.toMatch(/@modelcontextprotocol\/sdk/)
		}
	})
})
