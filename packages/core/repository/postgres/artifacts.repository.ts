import { MemberRemovedError } from "../../utils/refusal"

import { PostgresRepository } from "./db"
import {
	getOwnedArtifact,
	getVisibleArtifactRow,
	insertArtifact,
	listVisibleArtifactRows,
	moveArtifact,
	restoreArtifact,
	setArtifactAnyoneSettings,
	setArtifactPublishPolicy,
	setArtifactGeneralAccess,
	softDeleteArtifact,
} from "./gen/exagram_artifacts_sql"

import type { ArtifactListFilter, ArtifactsDatagateway } from "../../datagateway/artifacts.datagateway"
import type {
	AnyoneSettingsPatch,
	Artifact,
	ArtifactKind,
	DefaultPin,
	GeneralAccess,
	NewArtifact,
	PublishPolicy,
	VisibleArtifactRow,
} from "../../entity/artifact"
import type { Access, Principal } from "../../entity/principal"
import type { ExtractionStatus } from "../../entity/revision"
import type { Sql } from "postgres"

type ArtifactRow = {
	id: string
	workspaceId: string
	ownerId: string
	projectId: string | null
	kind: string
	title: string
	sourceFilename?: string | null
	sourceDescription?: string | null
	currentRevisionId: string | null
	defaultPin: string
	publishPolicy: string | null
	generalAccess: string
	deletedAt: Date | null
	createdAt: Date
}

type VisibleArtifactExtraRow = ArtifactRow & {
	revisionSeq: string | null
	// LEFT JOIN: null with no visible Revision, though sqlc types it as a string.
	revisionExtractionStatus: string | null
	updatedAt: Date | null
	ownerName: string
	sharedCount: string | null
	sharedWithNames: string[] | null
	effectivePublishPolicy: string | null
	workspaceName: string
	orgDomain: string | null
	// sqlc types a RETURNS TABLE column, and a computed one, looser than postgres.js delivers it.
	canDownload: unknown
	anyonePasswordOn: unknown
	anyonePasswordSet: unknown
	anyoneExpiresAt: Date | null
	anyoneDownload: unknown
}

const toVisibleArtifactExtras = (row: VisibleArtifactExtraRow) => ({
	revisionSeq: row.revisionSeq === null ? null : Number(row.revisionSeq),
	extractionStatus: row.revisionExtractionStatus as ExtractionStatus | null,
	updatedAt: row.updatedAt ?? row.createdAt,
	ownerName: row.ownerName,
	sharedCount: row.sharedCount === null ? 0 : Number(row.sharedCount),
	sharedWithNames: row.sharedWithNames ?? [],
	effectivePublishPolicy: (row.effectivePublishPolicy ?? "auto") as PublishPolicy,
	workspaceName: row.workspaceName,
	orgDomain: row.orgDomain,
	canDownload: row.canDownload as boolean,
	anyoneSettings: {
		passwordOn: row.anyonePasswordOn as boolean,
		passwordSet: row.anyonePasswordSet as boolean,
		expiresAt: row.anyoneExpiresAt,
		download: row.anyoneDownload as boolean,
	},
})

const toArtifact = (row: ArtifactRow): Artifact => ({
	id: row.id,
	workspaceId: row.workspaceId,
	ownerId: row.ownerId,
	projectId: row.projectId,
	kind: row.kind as ArtifactKind,
	title: row.title,
	sourceFilename: row.sourceFilename ?? null,
	sourceDescription: row.sourceDescription ?? null,
	currentRevisionId: row.currentRevisionId,
	defaultPin: row.defaultPin as DefaultPin,
	publishPolicy: row.publishPolicy as PublishPolicy | null,
	generalAccess: row.generalAccess as GeneralAccess,
	deletedAt: row.deletedAt,
	createdAt: row.createdAt,
})

export class ArtifactsRepository extends PostgresRepository implements ArtifactsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async listVisible(principal: Principal, filter: ArtifactListFilter): Promise<VisibleArtifactRow[]> {
		const rows = await listVisibleArtifactRows(this.sql, {
			principalKind: principal.kind,
			principalId: principal.id,
			scope: filter.scope,
			workspaceId: filter.workspaceId,
			kind: filter.kind ?? null,
			projectId: filter.projectId ?? null,
		})
		return rows.map((row) => ({
			...toArtifact(row as ArtifactRow),
			visibleRevisionId: (row as { visibleRevisionId: string | null }).visibleRevisionId,
			access: (row as { access: string }).access as Access,
			pinned: row.pinned as unknown as boolean,
			...toVisibleArtifactExtras(row as VisibleArtifactExtraRow),
		}))
	}

	async getVisible(principal: Principal, artifactId: string, unlockHash?: string): Promise<VisibleArtifactRow | null> {
		const row = await getVisibleArtifactRow(this.sql, {
			principalKind: principal.kind,
			principalId: principal.id,
			artifactId,
			unlock: unlockHash ?? null,
		})
		if (!row) return null
		return {
			...toArtifact(row as ArtifactRow),
			visibleRevisionId: (row as { visibleRevisionId: string | null }).visibleRevisionId,
			access: (row as { access: string }).access as Access,
			pinned: row.pinned as unknown as boolean,
			...toVisibleArtifactExtras(row as VisibleArtifactExtraRow),
		}
	}

	async create(input: NewArtifact): Promise<Artifact> {
		const row = await insertArtifact(this.sql, input)
		if (!row) throw new MemberRemovedError()
		return toArtifact(row as ArtifactRow)
	}

	async getOwned(id: string, ownerId: string): Promise<Artifact | null> {
		const row = await getOwnedArtifact(this.sql, { id, ownerId })
		return row ? toArtifact(row as ArtifactRow) : null
	}

	async move(id: string, ownerId: string, projectId: string | null): Promise<Artifact | null> {
		const row = await moveArtifact(this.sql, { id, ownerId, projectId })
		return row ? toArtifact(row as ArtifactRow) : null
	}

	async softDelete(id: string, ownerId: string): Promise<Artifact | null> {
		const row = await softDeleteArtifact(this.sql, { id, ownerId })
		return row ? toArtifact(row as ArtifactRow) : null
	}

	async restore(id: string, ownerId: string): Promise<Artifact | null> {
		const row = await restoreArtifact(this.sql, { id, ownerId })
		return row ? toArtifact(row as ArtifactRow) : null
	}

	async setPublishPolicy(id: string, userId: string, publishPolicy: PublishPolicy | null): Promise<boolean> {
		return (await setArtifactPublishPolicy(this.sql, { artifactId: id, userId, publishPolicy })) !== null
	}

	async setGeneralAccess(id: string, userId: string, generalAccess: GeneralAccess): Promise<boolean> {
		return (await setArtifactGeneralAccess(this.sql, { artifactId: id, userId, generalAccess })) !== null
	}

	async setAnyoneSettings(id: string, userId: string, patch: AnyoneSettingsPatch): Promise<boolean> {
		const row = await setArtifactAnyoneSettings(this.sql, {
			artifactId: id,
			userId,
			passwordOn: patch.passwordOn ?? null,
			passwordHash: patch.passwordHash ?? null,
			expiresAt: patch.expiresAt ?? null,
			clearExpiry: patch.expiresAt === null,
			download: patch.download ?? null,
		})
		return row !== null
	}
}
