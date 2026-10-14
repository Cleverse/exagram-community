export type RevisionStatus = "pending" | "approved" | "discarded"
export type ExtractionStatus = "none" | "queued" | "done" | "failed"

export interface RevisionSourceProvenance {
	parentRevisionId: string | null
	restoredFrom: string | null
	snippet: string | null
	origin: string | null
	clientId: string | null
	storagePath: string | null
	aiEdit: {
		model: string | null
		instruction: string | null
		scoped: boolean | null
		createdAt: Date | null
	} | null
}

export interface Revision {
	id: string
	artifactId: string
	seq: number
	status: RevisionStatus
	authorUserId: string
	authorConnectionId: string | null
	storageKey: string
	mime: string
	bytes: number
	sha256: string
	note: string | null
	extractedText: string | null
	extractionStatus: ExtractionStatus
	createdAt: Date
	approvedAt: Date | null
	sourceProvenance?: RevisionSourceProvenance | null
}

export interface NewRevision {
	artifactId: string
	seq: number
	authorUserId: string
	authorConnectionId: string | null
	storageKey: string
	mime: string
	bytes: number
	sha256: string
	note: string | null
	extractedText?: string | null
	extractionStatus: ExtractionStatus
}
