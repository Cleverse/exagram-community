import {
	getRevisionForParse,
	markExtractionDone,
	markExtractionFailed,
} from "@exagram/core/repository/postgres/gen/exagram_parse_sql"
import { sha256Hex } from "@exagram/core/utils/digest"

import type { ParsePayload } from "@exagram/core/services/jobs.port"
import type { ObjectStore } from "@exagram/core/services/object-store.service"
import type { ParsedKind, Parser } from "@exagram/parser"

import { BODY_MISMATCH_ERROR } from "../served-text"

import type { Sql } from "postgres"

const PARSED_KINDS: readonly string[] = ["pdf", "docx", "pptx", "xlsx"]

export function createParseJobHandler(deps: {
	sql: Sql
	objectStore: ObjectStore
	parser: Parser
	enqueueRedact(revisionId: string): Promise<void>
}): (payload: ParsePayload) => Promise<void> {
	return async ({ revisionId }) => {
		const revision = await getRevisionForParse(deps.sql, { revisionId })
		if (!revision) return
		if (revision.extractionStatus === "done") return
		if (revision.kind === "image") {
			await markExtractionDone(deps.sql, { revisionId, extractedText: null })
			return
		}
		if (!PARSED_KINDS.includes(revision.kind)) {
			await markExtractionFailed(deps.sql, {
				revisionId,
				extractionError: `No parser for kind ${revision.kind}`,
			})
			return
		}

		// objectStore.get and the repository calls can fail transiently (network, pool exhaustion);
		// let those propagate so pg-boss retries the job. Only a parser failure — the content itself
		// is unparseable — is terminal and marks the revision failed.
		const bytes = await deps.objectStore.get(revision.storageKey)
		if (sha256Hex(Buffer.from(bytes)) !== revision.sha256) {
			await markExtractionFailed(deps.sql, { revisionId, extractionError: BODY_MISMATCH_ERROR })
			return
		}
		let parsed
		try {
			parsed = await deps.parser.parse({
				bytes,
				mime: revision.mime,
				kind: revision.kind as ParsedKind,
			})
		} catch (error) {
			await markExtractionFailed(deps.sql, {
				revisionId,
				extractionError: error instanceof Error ? error.message : String(error),
			})
			return
		}
		await markExtractionDone(deps.sql, { revisionId, extractedText: parsed.text })
		await deps.enqueueRedact(revisionId)
	}
}
