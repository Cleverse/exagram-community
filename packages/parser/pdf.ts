import { PDFParse } from "pdf-parse"

import type { ParseOutput } from "./parser.port"

export async function parsePdf(bytes: Uint8Array): Promise<ParseOutput> {
	const parser = new PDFParse({ data: bytes })
	try {
		const result = await parser.getText()
		const text = result.pages.map((page, index) => `<!-- Page: ${index + 1} -->\n${page.text.trim()}`).join("\n\n")
		return { text, pages: result.total }
	} finally {
		await parser.destroy()
	}
}
