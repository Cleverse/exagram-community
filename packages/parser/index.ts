import { parseDocx } from "./docx"
import { checkTextBudget } from "./limits"
import { type ParseInput, type ParseOutput, type Parser, UnsupportedKindError } from "./parser.port"
import { parsePdf } from "./pdf"
import { parsePptx } from "./pptx"
import { parseXlsx } from "./xlsx"

const handlers: Record<ParseInput["kind"], (bytes: Uint8Array) => Promise<ParseOutput>> = {
	pdf: parsePdf,
	docx: parseDocx,
	pptx: parsePptx,
	xlsx: parseXlsx,
}

export function createParser(): Parser {
	return {
		async parse(input: ParseInput): Promise<ParseOutput> {
			const handler = handlers[input.kind]
			if (!handler) throw new UnsupportedKindError(input.kind)
			const output = await handler(input.bytes)
			checkTextBudget(output.text)
			return output
		},
	}
}

export { UnsupportedKindError } from "./parser.port"
export type { ParsedKind, ParseInput, ParseOutput, Parser } from "./parser.port"
