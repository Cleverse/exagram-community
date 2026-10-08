import { randomUUID } from "node:crypto"

import type { Sql } from "postgres"

function one<T extends Record<string, unknown>>(rows: T[]): Promise<T> {
	const row = rows[0]
	if (!row) throw new Error("seed insert returned no row")
	return Promise.resolve(row)
}

export async function seedWorkspace(sql: Sql, name = "Acme", id: string = randomUUID()): Promise<string> {
	const row = await one(
		await sql<{ id: string }[]>`
			INSERT INTO "exagram"."workspaces" ("id", "name") VALUES (${id}, ${name}) RETURNING "id"
		`,
	)
	return row.id
}

export async function seedEmptyPersonalWorkspace(
	sql: Sql,
	params: { name?: string; id?: string } = {},
): Promise<string> {
	const row = await one(
		await sql<{ id: string }[]>`
			INSERT INTO "exagram"."workspaces"
				("id", "name", "kind", "redaction", "default_share_role", "member_invites", "link_preview")
			VALUES (${params.id ?? randomUUID()}, ${params.name ?? "Personal"}, 'personal', 'off', 'view', false, 'generic')
			RETURNING "id"
		`,
	)
	return row.id
}

export async function seedPersonalWorkspace(
	sql: Sql,
	userId: string,
	params: { name?: string; id?: string; isAdmin?: boolean } = {},
): Promise<string> {
	const id = await seedEmptyPersonalWorkspace(sql, params)
	await seedMembership(sql, { userId, workspaceId: id, isAdmin: params.isAdmin })
	return id
}

export async function seedUser(
	sql: Sql,
	params: { workspaceId: string; email: string; name?: string; isAdmin?: boolean },
): Promise<string> {
	const row = await one(
		await sql<{ id: string }[]>`
			INSERT INTO "exagram"."users" ("workspace_id", "email", "name", "password_hash", "is_admin")
			VALUES (
				${params.workspaceId},
				${params.email},
				${params.name ?? params.email},
				${"$argon2id$seed"},
				${params.isAdmin ?? false}
			)
			RETURNING "id"
		`,
	)
	await seedMembership(sql, { userId: row.id, workspaceId: params.workspaceId, isAdmin: params.isAdmin })
	return row.id
}

export async function seedMembership(
	sql: Sql,
	params: { userId: string; workspaceId: string; isAdmin?: boolean; invited?: boolean; removed?: boolean },
): Promise<void> {
	await sql`
		INSERT INTO "exagram"."memberships"
			("user_id", "workspace_id", "kind", "role", "invited_at", "removed_at", "created_at")
		SELECT u."id", w."id", w."kind", ${params.isAdmin ? "admin" : "member"},
			${params.invited ? sql`now()` : null}, ${params.removed ? sql`now()` : null}, u."created_at"
		FROM "exagram"."workspaces" w, "exagram"."users" u
		WHERE w."id" = ${params.workspaceId} AND u."id" = ${params.userId}
		ON CONFLICT ("user_id", "workspace_id") DO UPDATE
		SET "role" = EXCLUDED."role", "invited_at" = EXCLUDED."invited_at", "removed_at" = EXCLUDED."removed_at"
	`
}

export async function seedProject(
	sql: Sql,
	params: { workspaceId: string; ownerId: string; name: string; parentProjectId?: string },
): Promise<string> {
	const row = await one(
		await sql<{ id: string }[]>`
			INSERT INTO "exagram"."projects" ("workspace_id", "owner_id", "parent_project_id", "name", "link_preview")
			VALUES (
				${params.workspaceId},
				${params.ownerId},
				${params.parentProjectId ?? null},
				${params.name},
				(SELECT "link_preview" FROM "exagram"."workspaces" WHERE "id" = ${params.workspaceId})
			)
			RETURNING "id"
		`,
	)
	return row.id
}

export type ArtifactKind = "doc" | "html" | "chat" | "pdf" | "docx" | "pptx" | "xlsx" | "image"

export async function seedArtifact(
	sql: Sql,
	params: {
		workspaceId: string
		ownerId: string
		title: string
		projectId?: string
		kind?: ArtifactKind
		defaultPin?: "latest" | "current"
	},
): Promise<string> {
	const row = await one(
		await sql<{ id: string }[]>`
			INSERT INTO "exagram"."artifacts"
				("workspace_id", "owner_id", "project_id", "kind", "title", "default_pin")
			VALUES (
				${params.workspaceId},
				${params.ownerId},
				${params.projectId ?? null},
				${params.kind ?? "doc"},
				${params.title},
				${params.defaultPin ?? "latest"}
			)
			RETURNING "id"
		`,
	)
	return row.id
}

export async function seedRevision(
	sql: Sql,
	params: {
		artifactId: string
		seq: number
		authorUserId: string
		authorConnectionId?: string
		bytes?: number
		mime?: string
		status?: "pending" | "approved" | "discarded"
	},
): Promise<string> {
	const row = await one(
		await sql<{ id: string }[]>`
			INSERT INTO "exagram"."revisions"
				("artifact_id", "seq", "author_user_id", "author_connection_id",
				 "storage_key", "mime", "bytes", "sha256"${params.status ? sql`, "status"` : sql``})
			VALUES (
				${params.artifactId},
				${params.seq},
				${params.authorUserId},
				${params.authorConnectionId ?? null},
				${`artifacts/${params.artifactId}/${params.seq}`},
				${params.mime ?? "text/markdown"},
				${params.bytes ?? 128},
				${"0".repeat(64)}${params.status ? sql`, ${params.status}` : sql``}
			)
			RETURNING "id"
		`,
	)
	return row.id
}

/**
 * What `approve_revision()` does in P2, written directly here so P1's suite does not depend on a
 * procedure a later phase ships. Both writes belong to one act: the revision becomes approved and
 * the artifact's Current Revision moves to it.
 */
export async function approveRevision(sql: Sql, artifactId: string, revisionId: string): Promise<void> {
	await sql`
		UPDATE "exagram"."revisions"
		SET "status" = 'approved', "approved_at" = now()
		WHERE "id" = ${revisionId}
	`
	await sql`
		UPDATE "exagram"."artifacts"
		SET "current_revision_id" = ${revisionId}
		WHERE "id" = ${artifactId}
	`
}

export async function softDeleteArtifact(sql: Sql, artifactId: string): Promise<void> {
	await sql`UPDATE "exagram"."artifacts" SET "deleted_at" = now() WHERE "id" = ${artifactId}`
}

export async function seedGrant(
	sql: Sql,
	params: {
		granteeId: string
		createdBy: string
		role: "view" | "collaborate" | "edit"
		artifactId?: string
		projectId?: string
		pinnedRevisionId?: string
	},
): Promise<string> {
	const row = await one(
		await sql<{ id: string }[]>`
			INSERT INTO "exagram"."grants"
				("artifact_id", "project_id", "grantee_id", "role", "pinned_revision_id", "created_by")
			VALUES (
				${params.artifactId ?? null},
				${params.projectId ?? null},
				${params.granteeId},
				${params.role},
				${params.pinnedRevisionId ?? null},
				${params.createdBy}
			)
			RETURNING "id"
		`,
	)
	return row.id
}

export async function seedConnection(
	sql: Sql,
	params: {
		userId: string
		scopes?: Array<"read" | "write" | "manage">
		name?: string
		revoked?: boolean
		oidcClientId?: string
		workspaceId?: string
	},
): Promise<string> {
	const row = await one(
		await sql<{ id: string }[]>`
			INSERT INTO "exagram"."connections"
				("user_id", "oidc_client_id", "name", "scopes", "revoked_at", "workspace_id")
			VALUES (
				${params.userId},
				${params.oidcClientId ?? `client-${randomUUID()}`},
				${params.name ?? "Seeded client"},
				${sql.array(params.scopes ?? ["read"])},
				${params.revoked ? sql`now()` : null},
				${params.workspaceId ?? null}
			)
			RETURNING "id"
		`,
	)
	return row.id
}

export async function seedLink(
	sql: Sql,
	params: {
		artifactId: string
		revisionId: string
		createdBy: string
		tokenHash?: string
		expiresInSec?: number
		maxViews?: number
		viewsUsed?: number
		revoked?: boolean
	},
): Promise<string> {
	const row = await one(
		await sql<{ id: string }[]>`
			INSERT INTO "exagram"."links"
				("artifact_id", "revision_id", "token_hash", "expires_at", "max_views", "views_used",
				 "revoked_at", "created_by")
			VALUES (
				${params.artifactId},
				${params.revisionId},
				${params.tokenHash ?? `hash-${params.artifactId}-${params.revisionId}-${params.viewsUsed ?? 0}`},
				${sql`now() + make_interval(secs => ${params.expiresInSec ?? 3600})`},
				${params.maxViews ?? null},
				${params.viewsUsed ?? 0},
				${params.revoked ? sql`now()` : null},
				${params.createdBy}
			)
			RETURNING "id"
		`,
	)
	return row.id
}
