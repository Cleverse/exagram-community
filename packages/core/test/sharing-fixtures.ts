import { randomUUID } from "node:crypto"

import type { Sql } from "postgres"

export interface SharingFixture {
	workspaceId: string
	ownerId: string
	granteeId: string
	granteeEmail: string
	outsiderId: string
	projectId: string
	childProjectId: string
	artifactId: string
	revisionOneId: string
	revisionTwoId: string
}

/** One workspace, an owner, a grantee, an outsider, a project with a child, and one doc Artifact with v1 and v2 both approved. */
export async function seedSharing(sql: Sql): Promise<SharingFixture> {
	const workspaceId = randomUUID()
	const ownerId = randomUUID()
	const granteeId = randomUUID()
	const outsiderId = randomUUID()
	const projectId = randomUUID()
	const childProjectId = randomUUID()
	const artifactId = randomUUID()
	const revisionOneId = randomUUID()
	const revisionTwoId = randomUUID()
	const granteeEmail = "grantee@example.com"

	await sql`INSERT INTO exagram.workspaces (id, name) VALUES (${workspaceId}, 'Acme')`
	await sql`INSERT INTO exagram.users (id, workspace_id, email, name, password_hash, is_admin)
		VALUES (${ownerId}, ${workspaceId}, 'owner@example.com', 'Owner', 'x', false),
		       (${granteeId}, ${workspaceId}, ${granteeEmail}, 'Grantee', 'x', false),
		       (${outsiderId}, ${workspaceId}, 'outsider@example.com', 'Outsider', 'x', false)`
	await sql`INSERT INTO exagram.memberships (user_id, workspace_id, kind, role, created_at)
		SELECT u.id, u.workspace_id, 'team', 'member', u.created_at FROM exagram.users u
		WHERE u.id IN (${ownerId}, ${granteeId}, ${outsiderId})
		ON CONFLICT (user_id, workspace_id) DO NOTHING`
	await sql`INSERT INTO exagram.projects (id, workspace_id, owner_id, parent_project_id, name)
		VALUES (${projectId}, ${workspaceId}, ${ownerId}, NULL, 'P'),
		       (${childProjectId}, ${workspaceId}, ${ownerId}, ${projectId}, 'P child')`
	await sql`INSERT INTO exagram.artifacts (id, workspace_id, owner_id, project_id, kind, title)
		VALUES (${artifactId}, ${workspaceId}, ${ownerId}, ${projectId}, 'doc', 'Quarterly plan')`
	await sql`INSERT INTO exagram.revisions (id, artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
		VALUES (${revisionOneId}, ${artifactId}, 1, ${ownerId}, 'artifacts/v1.md', 'text/markdown', 11, 'sha-v1'),
		       (${revisionTwoId}, ${artifactId}, 2, ${ownerId}, 'artifacts/v2.md', 'text/markdown', 11, 'sha-v2')`
	await sql`SELECT exagram.approve_revision(${revisionOneId}::uuid, ${ownerId}::uuid)`
	await sql`SELECT exagram.approve_revision(${revisionTwoId}::uuid, ${ownerId}::uuid)`

	return {
		workspaceId,
		ownerId,
		granteeId,
		granteeEmail,
		outsiderId,
		projectId,
		childProjectId,
		artifactId,
		revisionOneId,
		revisionTwoId,
	}
}
