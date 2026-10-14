import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { seedConnection, seedGrant, seedProject, seedUser, seedWorkspace } from "../../test/seed"

import { McpRepository } from "./mcp.repository"

describe("McpRepository.insertPendingUpload", () => {
	it("takes an Editor Grant on the folder only while it is awake", async () => {
		await withDb(async (sql) => {
			const ws = await seedWorkspace(sql)
			const owner = await seedUser(sql, { workspaceId: ws, email: "owner@example.com" })
			const editor = await seedUser(sql, { workspaceId: ws, email: "editor@example.com" })
			const projectId = await seedProject(sql, { workspaceId: ws, ownerId: owner, name: "P" })
			await seedGrant(sql, { projectId, granteeId: editor, role: "edit", createdBy: owner })
			const connectionId = await seedConnection(sql, { userId: editor })
			const repository = new McpRepository(sql)
			const upload = () => {
				const artifactId = randomUUID()
				return repository.insertPendingUpload({
					connectionId,
					projectId,
					artifactId,
					storageKey: `${artifactId}/1`,
					kind: "pdf",
					title: "Upload",
					mime: "application/pdf",
					bytes: 10,
				})
			}

			await sql`UPDATE exagram.grants SET dormant = true WHERE grantee_id = ${editor}`
			expect(await upload()).toBeNull()

			await sql`UPDATE exagram.grants SET dormant = false WHERE grantee_id = ${editor}`
			expect(await upload()).not.toBeNull()
		})
	})
})
