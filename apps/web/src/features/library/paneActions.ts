import { type ArtifactKind } from "@exagram/api-client"

/** doc / html / chat store their text inline, so `revisions.text` returns the exact bytes uploaded. */
export const TEXT_BACKED_KINDS: ReadonlySet<ArtifactKind> = new Set(["doc", "html", "chat"])

const EXTENSION_BY_MIME: Record<string, string> = {
	"text/markdown": "md",
	"text/plain": "txt",
	"text/csv": "csv",
	"text/html": "html",
	"application/json": "json",
}

/** The filename a text-backed download or duplicate is written under, so `kindForFile` recognises it again. */
export const downloadName = (title: string, mime: string): string => {
	const stem = title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "artifact"
	const extension = EXTENSION_BY_MIME[mime] ?? "txt"
	return stem.toLowerCase().endsWith(`.${extension}`) ? stem : `${stem}.${extension}`
}

export const saveBlob = (blob: Blob, filename: string): void => {
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement("a")
	anchor.href = url
	anchor.download = filename
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	URL.revokeObjectURL(url)
}
