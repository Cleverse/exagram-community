import { type ArtifactKind, type LibraryScope } from "@exagram/api-client"

export const QueryKeys = {
	auth: {
		me: () => ["auth", "me"] as const,
		providers: () => ["auth", "providers"] as const,
		invite: (token: string) => ["auth", "invite", token] as const,
		domainLink: (id: string) => ["auth", "domain-link", id] as const,
		joinOffer: (workspaceId: string) => ["auth", "join-offer", workspaceId] as const,
		resetLink: (token: string) => ["auth", "reset-link", token] as const,
	},
	workspace: {
		invites: () => ["workspace", "invites"] as const,
		members: () => ["workspace", "members"] as const,
		joining: () => ["workspace", "joining"] as const,
		seats: () => ["workspace", "seats"] as const,
		joinRequests: () => ["workspace", "joinRequests"] as const,
		/** The Workspace's Notification Email switch; Admins only. */
		notificationEmail: () => ["workspace", "notificationEmail"] as const,
	},
	projects: {
		list: () => ["projects", "list"] as const,
	},
	artifacts: {
		list: (filter: { scope: LibraryScope; kind?: ArtifactKind; projectId?: string | null }) =>
			["artifacts", "list", filter.scope, filter.kind ?? null, filter.projectId ?? null] as const,
		search: (query: { q: string; projectId?: string | null }) =>
			["artifacts", "search", query.q, query.projectId ?? null] as const,
		get: (artifactId: string) => ["artifacts", "get", artifactId] as const,
	},
	revisions: {
		list: (artifactId: string) => ["revisions", "list", artifactId] as const,
		text: (artifactId: string, revisionId: string | null) => ["revisions", "text", artifactId, revisionId] as const,
		/** One named Revision's text, for History's compare; keyed apart from the visible-text read above. */
		textAt: (artifactId: string, revisionId: string) => ["revisions", "textAt", artifactId, revisionId] as const,
		bodyToken: (artifactId: string, revisionId: string | null) =>
			["revisions", "bodyToken", artifactId, revisionId] as const,
		/** A named Pending Revision's body, read before it is approved; keyed apart from the visible body above. */
		bodyTokenAt: (artifactId: string, revisionId: string) =>
			["revisions", "bodyTokenAt", artifactId, revisionId] as const,
		previewToken: (artifactId: string, revisionId: string | null) =>
			["revisions", "previewToken", artifactId, revisionId] as const,
	},
	approvals: {
		pending: () => ["approvals", "pending"] as const,
	},
	grants: {
		list: (artifactId: string) => ["grants", "list", artifactId] as const,
		listForProject: (projectId: string) => ["grants", "listForProject", projectId] as const,
		/** Prefix; the last segment is the typed filter. */
		suggestions: (targetId: string) => ["grants", "suggestions", targetId] as const,
		/** The caller's own access on an Artifact or a Project. */
		access: (targetId: string) => ["grants", "access", targetId] as const,
	},
	accessRequests: {
		/** Open requests on Artifacts the reader owns. */
		list: () => ["accessRequests", "list"] as const,
	},
	notifications: {
		/** The caller's own Notification Preferences. */
		preferences: () => ["notifications", "preferences"] as const,
		/** The caller's own Notification Email settings, address and availability. */
		emailPreferences: () => ["notifications", "emailPreferences"] as const,
	},
	comments: {
		list: (artifactId: string) => ["comments", "list", artifactId] as const,
	},
	links: {
		list: (artifactId: string) => ["links", "list", artifactId] as const,
	},
	connections: {
		list: () => ["connections", "list"] as const,
		folders: (connectionId: string) => ["connections", "folders", connectionId] as const,
		consentInfo: (uid: string) => ["connections", "consentInfo", uid] as const,
	},
	ledger: {
		forArtifact: (artifactId: string) => ["ledger", "forArtifact", artifactId] as const,
		viewers: (artifactId: string) => ["ledger", "viewers", artifactId] as const,
		activityWindow: (limit: number) => ["ledger", "activityWindow", limit] as const,
	},
	redaction: {
		all: ["redaction"] as const,
		project: (projectId: string) => ["redaction", "project", projectId] as const,
		artifact: (artifactId: string) => ["redaction", "artifact", artifactId] as const,
		redactedText: (revisionId: string) => ["redaction", "redactedText", revisionId] as const,
		workspace: () => ["redaction", "workspace"] as const,
	},
} as const
