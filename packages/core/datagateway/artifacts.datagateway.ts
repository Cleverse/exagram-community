import type {
	AnyoneSettingsPatch,
	Artifact,
	ArtifactKind,
	GeneralAccess,
	NewArtifact,
	PublishPolicy,
	VisibleArtifactRow,
} from "../entity/artifact"
import type { Principal } from "../entity/principal"

export type ArtifactScope = "all" | "sharedWithMe" | "mine"

export interface ArtifactListFilter {
	workspaceId: string
	scope: ArtifactScope
	kind?: ArtifactKind
	projectId?: string
}

/**
 * Reads the same boundary function as `VisibilityDatagateway` but hands back whole Artifact rows, so it
 * deliberately does not extend that port: `listVisible` and `getVisible` here carry filters and full
 * rows. The Ledger path takes `VisibilityDatagateway`; the catalogue path takes this one.
 */
export interface ArtifactsDatagateway {
	listVisible(principal: Principal, filter: ArtifactListFilter): Promise<VisibleArtifactRow[]>
	/**
	 * The artifact row plus the access the boundary granted; null when the principal cannot see it.
	 * `unlockHash` is the sha256 of the reader's unlock cookie for this Artifact (ADR 0044), forwarded to SQL.
	 */
	getVisible(principal: Principal, artifactId: string, unlockHash?: string): Promise<VisibleArtifactRow | null>
	/** Throws MemberRemovedError when the owner is Removed, including by a removal it waited on. */
	create(input: NewArtifact): Promise<Artifact>
	getOwned(id: string, ownerId: string): Promise<Artifact | null>
	move(id: string, ownerId: string, projectId: string | null): Promise<Artifact | null>
	softDelete(id: string, ownerId: string): Promise<Artifact | null>
	restore(id: string, ownerId: string): Promise<Artifact | null>
	/** Null clears the override. Updates nothing, and answers false, unless `userId` is the Owner. */
	setPublishPolicy(id: string, userId: string, publishPolicy: PublishPolicy | null): Promise<boolean>
	setGeneralAccess(id: string, userId: string, generalAccess: GeneralAccess): Promise<boolean>
	/** Updates nothing, and answers false, unless `userId` is the Owner. Absent fields stay as they are. */
	setAnyoneSettings(id: string, userId: string, patch: AnyoneSettingsPatch): Promise<boolean>
}
