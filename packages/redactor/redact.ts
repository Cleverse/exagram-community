import { FINDING_TYPES, type Finding, type FindingType } from "./redactor.port"

const PLACEHOLDER = /\[([A-Z_]+)\]/

const IS_FINDING_TYPE = new Set<string>(FINDING_TYPES)

/**
 * Placeholders are typed and unnumbered: two addresses in one Revision both become `[EMAIL]`, so
 * the result never leaks how many distinct values there were (ADR 0019).
 */
export function redact(text: string, findings: readonly Finding[]): string {
	let out = ""
	let cursor = 0
	for (const finding of findings) {
		out += text.slice(cursor, finding.start) + `[${finding.type}]`
		cursor = finding.end
	}
	return out + text.slice(cursor)
}

/**
 * The placeholder types literally present in `text`, deduplicated and sorted. Sorted rather than in
 * `FINDING_TYPES` order because the result is stored in `revisions.placeholder_types` and compared
 * there, so reordering the type list must not change what an existing row means.
 */
export function findPlaceholderTypes(text: string): FindingType[] {
	const cursor = new RegExp(PLACEHOLDER.source, "g")
	const seen = new Set<FindingType>()
	for (let match = cursor.exec(text); match !== null; match = cursor.exec(text)) {
		if (IS_FINDING_TYPE.has(match[1]!)) seen.add(match[1] as FindingType)
	}
	return [...seen].sort()
}
