import { PostgresRepository } from "./db"
import {
	getRevisionById,
	getRevisionByStorageKey,
	getRevisionInArtifact,
	insertRevision,
	listRevisionsByArtifact,
	lockArtifactRevisions,
	lockStorageKey as lockStorageKeyQuery,
	nextRevisionSeq,
	publishInPersonal,
	publishOnUpload,
} from "./gen/exagram_revisions_sql"

import type { RevisionsDatagateway } from "../../datagateway/revisions.datagateway"
import type { ExtractionStatus, NewRevision, Revision, RevisionStatus } from "../../entity/revision"
import type { Sql } from "postgres"

type RevisionRow = {
	id: string
	artifactId: string
	seq: number
	status: string
	authorUserId: string
	authorConnectionId: string | null
	storageKey: string
	mime: string
	bytes: number
	sha256: string
	note: string | null
	extractedText: string | null
	extractionStatus: string
	createdAt: Date
	approvedAt: Date | null
	sourceParentRevisionId?: string | null
	sourceRestoredFrom?: string | null
	sourceSnippet?: string | null
	sourceOrigin?: string | null
	sourceClientId?: string | null
	sourceStoragePath?: string | null
	sourceAiRevisionId?: string | null
	sourceAiModel?: string | null
	sourceAiInstruction?: string | null
	sourceAiScoped?: boolean | null
	sourceAiCreatedAt?: Date | null
}

const toRevision = (row: RevisionRow): Revision => ({
	...row,
	status: row.status as RevisionStatus,
	extractionStatus: row.extractionStatus as ExtractionStatus,
	sourceProvenance:
		row.sourceStoragePath === null || row.sourceStoragePath === undefined
			? null
			: {
					parentRevisionId: row.sourceParentRevisionId ?? null,
					restoredFrom: row.sourceRestoredFrom ?? null,
					snippet: row.sourceSnippet ?? null,
					origin: row.sourceOrigin ?? null,
					clientId: row.sourceClientId ?? null,
					storagePath: row.sourceStoragePath ?? null,
					aiEdit: row.sourceAiRevisionId
						? {
								model: row.sourceAiModel ?? null,
								instruction: row.sourceAiInstruction ?? null,
								scoped: row.sourceAiScoped ?? null,
								createdAt: row.sourceAiCreatedAt ?? null,
							}
						: null,
				},
})

export class RevisionsRepository extends PostgresRepository implements RevisionsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async lockArtifact(artifactId: string): Promise<void> {
		await lockArtifactRevisions(this.sql, { artifactId })
	}

	async lockStorageKey(storageKey: string): Promise<void> {
		await lockStorageKeyQuery(this.sql, { storageKey })
	}

	async nextSeq(artifactId: string): Promise<number> {
		const row = await nextRevisionSeq(this.sql, { artifactId })
		return row?.nextSeq ?? 1
	}

	async insert(input: NewRevision): Promise<Revision> {
		// sqlc types `seq` and `bytes` as string on InsertRevisionArgs (loose inference off the
		// multi-row VALUES list), even though the columns are int4 and int; the query itself is untouched.
		const row = await insertRevision(this.sql, {
			...input,
			extractedText: input.extractedText ?? null,
			seq: input.seq as unknown as string,
			bytes: input.bytes as unknown as string,
		})
		if (!row) throw new Error("insert revision returned no row")
		return toRevision(row as RevisionRow)
	}

	async publishOnUpload(revisionId: string, authorUserId: string): Promise<Revision | null> {
		const row = await publishOnUpload(this.sql, { revisionId, authorUserId })
		return row?.publishedRevisionId ? this.getById(row.publishedRevisionId) : null
	}

	async publishInPersonal(revisionId: string, authorUserId: string): Promise<Revision | null> {
		const row = await publishInPersonal(this.sql, { revisionId, authorUserId })
		return row?.publishedRevisionId ? this.getById(row.publishedRevisionId) : null
	}

	async listByArtifact(artifactId: string): Promise<Revision[]> {
		const rows = await listRevisionsByArtifact(this.sql, { artifactId })
		return rows.map((row) => toRevision(row as RevisionRow))
	}

	async getById(id: string): Promise<Revision | null> {
		const row = await getRevisionById(this.sql, { id })
		return row ? toRevision(row as RevisionRow) : null
	}

	async getInArtifact(id: string, artifactId: string): Promise<Revision | null> {
		const row = await getRevisionInArtifact(this.sql, { id, artifactId })
		return row ? toRevision(row as RevisionRow) : null
	}

	async getByStorageKey(artifactId: string, storageKey: string): Promise<Revision | null> {
		const row = await getRevisionByStorageKey(this.sql, { artifactId, storageKey })
		return row ? toRevision(row as RevisionRow) : null
	}
}
