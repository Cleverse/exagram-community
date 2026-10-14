import type { NewRevision, Revision } from "../entity/revision"

export interface RevisionsDatagateway {
	/** Transaction-scoped lock on one artifact: two uploads cannot claim the same `seq`. */
	lockArtifact(artifactId: string): Promise<void>
	/** Transaction-scoped lock on one storage key: two finalize calls on the same ticket serialise. */
	lockStorageKey(storageKey: string): Promise<void>
	nextSeq(artifactId: string): Promise<number>
	insert(input: NewRevision): Promise<Revision>
	/**
	 * Publishes the author's own upload on arrival: approved and made Current. Returns null, and
	 * changes nothing, unless the Artifact's publish policy is 'auto' and the author's access on it
	 * is 'owner' or 'edit' (exagram.publish_on_upload decides both).
	 */
	publishOnUpload(revisionId: string, authorUserId: string): Promise<Revision | null>
	publishInPersonal(revisionId: string, authorUserId: string): Promise<Revision | null>
	listByArtifact(artifactId: string): Promise<Revision[]>
	getById(id: string): Promise<Revision | null>
	getInArtifact(id: string, artifactId: string): Promise<Revision | null>
	getByStorageKey(artifactId: string, storageKey: string): Promise<Revision | null>
	/** The keys among `storageKeys` that some Revision, in any Artifact, still names. */
	storageKeysInUse(storageKeys: readonly string[]): Promise<Set<string>>
}
