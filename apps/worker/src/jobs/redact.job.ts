import { createHash } from "node:crypto"

import {
	getRevisionForRedaction,
	markRedactionUnavailable,
	resetImageRedaction,
	storeRedactedText,
} from "@exagram/core/repository/postgres/gen/exagram_redaction_sql"
import {
	NULL_DETECTOR_VERSION,
	REDACTION_LIMIT_BYTES,
	findPlaceholderTypes,
	nullRedaction,
	redact,
	type Detector,
} from "@exagram/redactor"

import type { RedactPayload } from "@exagram/core/services/jobs.port"

import { BODY_MISMATCH_ERROR, resolveServedText } from "../served-text"

import type { Sql } from "postgres"

export function createRedactJobHandler(deps: {
	sql: Sql
	objectStore: { read(storageKey: string, sha256: string): Promise<string | null> }
	detector: Detector
}): (payload: RedactPayload) => Promise<void> {
	return async ({ revisionId }) => {
		const revision = await getRevisionForRedaction(deps.sql, { revisionId })
		if (!revision) return
		if (revision.kind === "image") {
			await resetImageRedaction(deps.sql, { revisionId, queuedToken: revision.queuedToken })
			return
		}

		const served = await resolveServedText(revision, deps.objectStore)
		if (!served.ok && served.reason === "extraction-pending") return

		// No detection, but the job still runs: it records the author's placeholder types, which approval asks to
		// confirm, and marks the Revision done at a version below MIN_ACCEPTED_DETECTOR_VERSION, so an install that
		// later adds a Detector re-checks it. Nothing to size-limit and nothing to keep. `done` is what unblocks
		// approve_revision for a Connection's Revision (000011), so only an integrity failure may stop it. ""
		// withholds from a redacted Connection read and keeps no second plaintext copy.
		// The parse job records a digest mismatch as a failed extraction (parse.job.ts:43-45); it is still an integrity failure.
		const integrityFailure =
			!served.ok && (served.reason === "body-mismatch" || revision.extractionError === BODY_MISMATCH_ERROR)
		if (deps.detector.version === NULL_DETECTOR_VERSION && !integrityFailure) {
			const text = served.ok ? served.text : ""
			await storeRedactedText(deps.sql, {
				revisionId,
				...nullRedaction(text),
				inputSha256: createHash("sha256").update(text, "utf-8").digest("hex"),
				queuedToken: revision.queuedToken,
			})
			return
		}

		if (!served.ok) {
			await markRedactionUnavailable(deps.sql, {
				revisionId,
				redactionStatus: "failed",
				redactionError:
					served.reason === "body-mismatch"
						? BODY_MISMATCH_ERROR
						: "No Extracted Text: the parser failed for this Revision.",
				queuedToken: revision.queuedToken,
			})
			return
		}

		if (Buffer.byteLength(served.text, "utf-8") > REDACTION_LIMIT_BYTES) {
			await markRedactionUnavailable(deps.sql, {
				revisionId,
				redactionStatus: "too_large",
				redactionError: null,
				queuedToken: revision.queuedToken,
			})
			return
		}

		const redactedText = redact(served.text, deps.detector.detect(served.text))
		// A null result means the Revision was reset or re-claimed meanwhile; the newer queue entry redoes it.
		await storeRedactedText(deps.sql, {
			revisionId,
			redactedText,
			detectorVersion: deps.detector.version,
			inputSha256: createHash("sha256").update(served.text, "utf-8").digest("hex"),
			placeholderTypes: findPlaceholderTypes(redactedText),
			queuedToken: revision.queuedToken,
		})
	}
}
