import type { FindingType } from "@exagram/redactor"

export { REDACTION_LIMIT_BYTES } from "@exagram/redactor"

/** NULL in the database, `null` here: inherit from the parent. */
export type RedactionSetting = "on" | "off" | null

export type RedactionStatus = "none" | "queued" | "done" | "failed" | "too_large"

/** Where an inherited value would come from if `own` were null. */
export type RedactionSource = "project" | "parentProject" | "workspace"

export interface EffectiveRedaction {
	/** What a read resolves to right now. */
	effective: boolean
	/** What this Project or Artifact carries itself; null means it inherits. */
	own: RedactionSetting
	/** Named even while `own` is set, so the UI can label the inherit option either way. */
	inheritedFrom: RedactionSource
	inheritedValue: boolean
}

export type WorkspaceRedactionSetting = "on" | "off"

export interface RevisionRedaction {
	revisionId: string
	status: RedactionStatus
	detectorVersion: number | null
	placeholderTypes: FindingType[]
}
