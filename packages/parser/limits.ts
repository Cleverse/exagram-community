import { unzipSync } from "fflate"

/** Ceiling on what a zip-based parser (pptx, xlsx) will inflate, checked against the central directory before decompressing. */
export const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024

/** Ceiling on the extracted text a parser may hand back, checked in bytes (UTF-8), not characters. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024

export class ParseLimitError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ParseLimitError"
	}
}

/**
 * Reads a zip's central directory and sums each entry's `originalSize` without inflating any
 * entry — fflate's filter callback runs per central-directory record, before decompression, and
 * returning `false` skips extraction. Throws once the running total would exceed the budget.
 */
export function checkZipBudget(bytes: Uint8Array): void {
	let total = 0
	unzipSync(bytes, {
		filter: (file) => {
			total += file.originalSize
			if (total > MAX_DECOMPRESSED_BYTES) {
				throw new ParseLimitError(`archive expands beyond ${MAX_DECOMPRESSED_BYTES / (1024 * 1024)} MB`)
			}
			return false
		},
	})
}

export function checkTextBudget(text: string): void {
	if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
		throw new ParseLimitError(`extracted text exceeds ${MAX_TEXT_BYTES / (1024 * 1024)} MB`)
	}
}
