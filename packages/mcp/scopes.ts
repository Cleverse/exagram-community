import { SCOPES, TOOL_NAMES, TOOL_SCOPES, type Scope, type ToolName } from "./registry"

/**
 * One sentence for every boundary refusal, and it is the same sentence the human API and the Link
 * page say. An Artifact this Connection does not reach, a Pending Revision it may not read, and an
 * id that never existed all get this and nothing else, so no call distinguishes withheld from not
 * found.
 */
export { NARROWED_REFUSAL_TEXT, REFUSAL_TEXT } from "@exagram/core/utils/refusal"

export function isToolName(value: string): value is ToolName {
	return (TOOL_NAMES as readonly string[]).includes(value)
}

export function requiredScope(tool: ToolName): Scope {
	return TOOL_SCOPES[tool]
}

export function toolsForScopes(granted: readonly Scope[]): ToolName[] {
	return TOOL_NAMES.filter((name) => granted.includes(TOOL_SCOPES[name]))
}

export function scopeDenialMessage(tool: ToolName, missing: Scope): string {
	const usable = toolsForScopes(SCOPES.filter((scope) => scope !== missing))
	return [
		`Refused: "${tool}" requires the ${missing} scope, and this connection was not granted it.`,
		"Nothing was created, changed or removed.",
		"The account owner grants it by reconnecting this client and ticking that scope on the consent page.",
		usable.length > 0
			? `Tools that do not need it: ${usable.join(", ")}.`
			: "No tool is available to this connection until it is reconnected.",
	].join(" ")
}
