export type ExtractedSection = { heading: string | null; body: string }

/**
 * `@exagram/parser` writes one marker line per page, slide or sheet in exactly this form, and the
 * AI reads the same string. It is the only place that literal appears in the web app.
 */
const MARKER = /^<!--\s*(Page|Slide|Sheet):\s*(.+?)\s*-->$/

export const splitExtractedText = (text: string): ExtractedSection[] => {
	const sections: ExtractedSection[] = []
	let heading: string | null = null
	let lines: string[] = []

	const flush = () => {
		const body = lines.join("\n").trim()
		if (heading !== null || body !== "") sections.push({ heading, body })
		lines = []
	}

	for (const line of text.split("\n")) {
		const match = MARKER.exec(line.trim())
		if (!match) {
			lines.push(line)
			continue
		}
		flush()
		heading = `${match[1]} ${match[2]}`
	}
	flush()

	return sections.length === 0 ? [{ heading: null, body: "" }] : sections
}
