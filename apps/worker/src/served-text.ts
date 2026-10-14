import { EXTRACTED_KINDS, type ArtifactKind } from "@exagram/core/entity/artifact"
import { sha256Hex } from "@exagram/core/utils/digest"

import type { ObjectStore } from "@exagram/core/services/object-store.service"

export { EXTRACTED_KINDS }

/**
 * A presigned PUT can overwrite an object until its ticket expires, so text is only made from bytes whose digest is
 * the one the Revision recorded.
 */
export const BODY_MISMATCH_ERROR = "Stored bytes don't match the Revision."

export type ServedText =
	| { ok: true; text: string }
	| { ok: false; reason: "extraction-pending" | "extraction-failed" | "body-mismatch" }

export async function resolveServedText(
	revision: {
		kind: string
		storageKey: string
		sha256: string
		extractedText: string | null
		extractionStatus: string
	},
	store: { read(storageKey: string, sha256: string): Promise<string | null> },
): Promise<ServedText> {
	if (!EXTRACTED_KINDS.has(revision.kind as ArtifactKind)) {
		const text = await store.read(revision.storageKey, revision.sha256)
		return text === null ? { ok: false, reason: "body-mismatch" } : { ok: true, text }
	}
	if (revision.extractionStatus === "failed") return { ok: false, reason: "extraction-failed" }
	if (revision.extractionStatus !== "done") return { ok: false, reason: "extraction-pending" }
	return { ok: true, text: revision.extractedText ?? "" }
}

/** The body as text, or null when its bytes aren't the ones whose digest is `sha256`. */
export const readObjectAsText = (store: ObjectStore) => ({
	read: async (storageKey: string, sha256: string) => {
		const bytes = Buffer.from(await store.get(storageKey))
		return sha256Hex(bytes) === sha256 ? bytes.toString("utf-8") : null
	},
})
