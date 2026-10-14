import type { ArtifactKind } from "../entity/artifact"

export const INLINE_TEXT_LIMIT_BYTES = 1_048_576

export interface ExtractionOnFinalize {
	status: "done" | "queued"
	text: string | null
}

const decodeCapped = (bytes: Uint8Array) =>
	// A byte cut can land inside a multi-byte code point; the decoder emits U+FFFD for the
	// dangling tail, and only a trailing one can come from the cut.
	new TextDecoder().decode(bytes.subarray(0, INLINE_TEXT_LIMIT_BYTES)).replace(/�+$/, "")

const stripHtml = (html: string) =>
	html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim()

/**
 * The one place that decides what `revisions.extracted_text` holds at finalize.
 * doc/chat/html are inlined here, images carry no text, and office documents wait for the parse job.
 */
export function extractionOnFinalize(kind: ArtifactKind, bytes: Uint8Array): ExtractionOnFinalize {
	switch (kind) {
		case "doc":
		case "chat":
			return { status: "done", text: decodeCapped(bytes) }
		case "html":
			return { status: "done", text: stripHtml(decodeCapped(bytes)) }
		case "image":
			return { status: "done", text: null }
		default:
			return { status: "queued", text: null }
	}
}

export const needsParseJob = (kind: ArtifactKind) => extractionOnFinalize(kind, new Uint8Array()).status === "queued"
