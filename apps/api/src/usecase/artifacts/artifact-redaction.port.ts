import type { EffectiveRedaction, RedactionSetting } from "@exagram/core/entity/redaction"

/** The Redaction Setting reads and writes a duplicate needs. Community has no setting, so it reads null. */
export interface ArtifactRedactionPort {
	getArtifactRedaction(artifactId: string, ownerId: string): Promise<EffectiveRedaction | null>
	setArtifactRedaction(artifactId: string, ownerId: string, value: RedactionSetting): Promise<EffectiveRedaction | null>
}

export const noArtifactRedaction: ArtifactRedactionPort = {
	getArtifactRedaction: () => Promise.resolve(null),
	setArtifactRedaction: () => Promise.resolve(null),
}
