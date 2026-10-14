export type ParsedKind = "pdf" | "docx" | "pptx" | "xlsx"

export interface ParseInput {
	bytes: Uint8Array
	mime: string
	kind: ParsedKind
}

/** `pages` counts pages (pdf), slides (pptx) or sheets (xlsx); docx has none. */
export interface ParseOutput {
	text: string
	pages?: number
}

export interface Parser {
	parse(input: ParseInput): Promise<ParseOutput>
}

export class UnsupportedKindError extends Error {
	constructor(kind: string) {
		super(`No parser for kind ${kind}`)
		this.name = "UnsupportedKindError"
	}
}
