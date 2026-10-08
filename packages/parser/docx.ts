import mammoth from "mammoth"

import type { ParseOutput } from "./parser.port"

export async function parseDocx(bytes: Uint8Array): Promise<ParseOutput> {
	const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
	return { text: result.value.trim() }
}
