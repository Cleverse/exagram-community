import { type ArtifactKind } from "@exagram/api-client"

/** `revisions.bytes` is checked `> 0 and <= 20971520` in the schema; refuse early, refuse the same. */
export const MAX_BODY_BYTES = 20_971_520

const BY_EXTENSION: Record<string, { kind: ArtifactKind; mime: string }> = {
	md: { kind: "doc", mime: "text/markdown" },
	markdown: { kind: "doc", mime: "text/markdown" },
	csv: { kind: "doc", mime: "text/csv" },
	txt: { kind: "doc", mime: "text/plain" },
	html: { kind: "html", mime: "text/html" },
	htm: { kind: "html", mime: "text/html" },
	json: { kind: "chat", mime: "application/json" },
	pdf: { kind: "pdf", mime: "application/pdf" },
	docx: { kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
	pptx: { kind: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
	xlsx: { kind: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
	png: { kind: "image", mime: "image/png" },
	jpg: { kind: "image", mime: "image/jpeg" },
	jpeg: { kind: "image", mime: "image/jpeg" },
	webp: { kind: "image", mime: "image/webp" },
	gif: { kind: "image", mime: "image/gif" },
	heic: { kind: "image", mime: "image/heic" },
	heif: { kind: "image", mime: "image/heif" },
}

/** Marks every running upload, so `useIsMutating` can tell whether one is still in flight. */
export const UPLOAD_MUTATION_KEY = ["upload"] as const

export const UPLOAD_ACCEPT =
	".md,.markdown,.txt,.csv,.html,.htm,.json,.pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif"

export const kindForFile = (filename: string): { kind: ArtifactKind; mime: string } | null => {
	const extension = filename.split(".").pop()?.toLowerCase() ?? ""
	return BY_EXTENSION[extension] ?? null
}

export const checkUpload = (file: { name: string; size: number }): string | null => {
	if (kindForFile(file.name) === null) {
		return `Exagram stores Markdown, text, CSV, HTML, conversations (.json), PDF, Word, Slides, Sheets, PNG, JPEG, WebP, GIF, HEIC and HEIF — "${file.name}" is none of those`
	}
	if (file.size <= 0) return "This file is empty — Exagram cannot store an empty Revision"
	if (file.size > MAX_BODY_BYTES) {
		return `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — over the 20 MB limit per Revision`
	}
	return null
}

export const titleFromFilename = (filename: string) => filename.replace(/\.[^.]+$/, "")

export const sha256Hex = async (file: Blob): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
}
