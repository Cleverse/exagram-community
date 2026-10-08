export interface Link {
	id: string
	artifactId: string
	revisionId: string
	expiresAt: Date
	maxViews: number | null
	viewsUsed: number
	revokedAt: Date | null
	createdBy: string
	createdAt: Date
}

export interface NewLink {
	artifactId: string
	revisionId: string
	tokenHash: string
	expiresAt: Date
	maxViews: number | null
	createdBy: string
}
