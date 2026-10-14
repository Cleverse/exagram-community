import { type ArtifactKind } from "@exagram/api-client"

export const KIND_ORDER: ArtifactKind[] = ["doc", "html", "chat", "image", "pdf", "docx", "pptx", "xlsx"]

export const KIND_LABEL: Record<ArtifactKind, string> = {
	doc: "Doc",
	html: "HTML",
	chat: "Chat",
	pdf: "PDF",
	docx: "Word",
	pptx: "Slides",
	xlsx: "Sheet",
	image: "Image",
}

/** The short mono tag shown on a kind's icon badge in the library rows. */
export const KIND_TAG: Record<ArtifactKind, string> = {
	doc: "MD",
	html: "HTML",
	chat: "CHAT",
	pdf: "PDF",
	docx: "DOCX",
	pptx: "PPT",
	xlsx: "XLS",
	image: "IMG",
}

/** The custom MIME an in-app row drag carries; an OS file drop uses `Files` instead. */
export const ARTIFACT_DRAG_TYPE = "application/x-exagram-artifact-id"

/** The custom MIME an in-app Project drag carries (a sidebar row or a folder row), apart from a file row's. */
export const PROJECT_DRAG_TYPE = "application/x-exagram-project-id"
