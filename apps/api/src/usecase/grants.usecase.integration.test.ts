import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { withDb } from "@exagram/core/test/pg"
import { seedUser } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { ConflictError } from "@exagram/core/utils/errors"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { GrantsUsecase } from "./grants.usecase"

describe("GrantsUsecase (integration)", () => {
	it("creates a grant from an email in the same workspace and lists it for the owner", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))

			const grant = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "view",
			})
			expect(grant).toMatchObject({ granteeId: fx.granteeId, role: "view", pinnedRevisionId: null })

			const items = await usecase.list(fx.ownerId, { artifactId: fx.artifactId })
			expect(items).toHaveLength(1)
		})
	})

	it("refuses list, suggestions and create to a Viewer", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			await usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "view" })

			await expect(usecase.suggestions(fx.granteeId, { artifactId: fx.artifactId })).rejects.toThrow(REFUSAL_TEXT)
			await expect(usecase.list(fx.granteeId, { artifactId: fx.artifactId })).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.create(fx.granteeId, {
					artifactId: fx.artifactId,
					granteeEmail: "outsider@example.com",
					role: "view",
				}),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("refuses an email outside the Workspace, held elsewhere or not, the same way where inviting is off", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const [other] = await sql<{ id: string }[]>`INSERT INTO exagram.workspaces (name) VALUES ('Other') RETURNING id`
			const stranger = await seedUser(sql, { workspaceId: other!.id, email: "stranger@example.com", name: "Stranger" })

			const held = await usecase
				.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "stranger@example.com", role: "view" })
				.catch((error: Error) => error.message)
			expect(held).toBe(REFUSAL_TEXT)
			expect(await sql`SELECT 1 FROM exagram.grants WHERE grantee_id = ${stranger}`).toEqual([])
			const unknown = await usecase
				.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "nobody@example.com", role: "view" })
				.catch((error: Error) => error.message)
			expect(unknown).toBe(REFUSAL_TEXT)
		})
	})

	it("refuses a duplicate grant to the same artifact and grantee with a clean conflict", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			await usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "view" })

			await expect(
				usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "edit" }),
			).rejects.toThrow(ConflictError)
		})
	})

	it("caps an invite at the inviter's own role and keeps role changes the Owner's", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const extra = await seedUser(sql, { workspaceId: fx.workspaceId, email: "third@example.com", name: "Third" })

			// The grantee is a Collaborator: they may list and invite up to Collaborator.
			await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "collaborate",
			})
			await expect(usecase.list(fx.granteeId, { artifactId: fx.artifactId })).resolves.toHaveLength(1)
			await expect(
				usecase.create(fx.granteeId, { artifactId: fx.artifactId, granteeEmail: "outsider@example.com", role: "edit" }),
			).rejects.toThrow(REFUSAL_TEXT)
			const invited = await usecase.create(fx.granteeId, {
				artifactId: fx.artifactId,
				granteeEmail: "outsider@example.com",
				role: "collaborate",
			})
			expect(invited).toMatchObject({ granteeId: fx.outsiderId, role: "collaborate" })
			await expect(usecase.updateRole(fx.granteeId, invited.id, "view")).rejects.toThrow(REFUSAL_TEXT)
			await expect(usecase.remove(fx.granteeId, invited.id)).rejects.toThrow(REFUSAL_TEXT)

			// Promoted to Editor, the grantee may now invite at Editor, but still not manage.
			const own = (await usecase.list(fx.ownerId, { artifactId: fx.artifactId })).find(
				(grant) => grant.granteeId === fx.granteeId,
			)!
			await usecase.updateRole(fx.ownerId, own.id, "edit")
			await expect(
				usecase.create(fx.granteeId, { artifactId: fx.artifactId, granteeEmail: "third@example.com", role: "edit" }),
			).resolves.toMatchObject({ granteeId: extra, role: "edit" })
			await expect(usecase.remove(fx.granteeId, invited.id)).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("lets a Project Collaborator invite to the Project and its child up to Collaborator", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			await usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: fx.granteeEmail, role: "collaborate" })

			await expect(
				usecase.create(fx.granteeId, {
					projectId: fx.childProjectId,
					granteeEmail: "outsider@example.com",
					role: "edit",
				}),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.create(fx.granteeId, {
					projectId: fx.childProjectId,
					granteeEmail: "outsider@example.com",
					role: "view",
				}),
			).resolves.toMatchObject({ granteeId: fx.outsiderId, role: "view" })
			await expect(usecase.list(fx.granteeId, { projectId: fx.projectId })).resolves.toHaveLength(1)
		})
	})

	it("suggests workspace members not yet on the target, never the caller or the Owner", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))

			const before = await usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId })
			expect(before.map((person) => person.id).sort()).toEqual([fx.granteeId, fx.outsiderId].sort())

			await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "collaborate",
			})
			await expect(usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId })).resolves.toEqual([
				{ id: fx.outsiderId, name: "Outsider", email: "outsider@example.com", pending: false },
			])
			// The Collaborator is offered neither themselves nor the Owner.
			await expect(usecase.suggestions(fx.granteeId, { artifactId: fx.artifactId })).resolves.toEqual([
				{ id: fx.outsiderId, name: "Outsider", email: "outsider@example.com", pending: false },
			])
			await expect(usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId, query: "nobody" })).resolves.toEqual([])
		})
	})

	it("refuses a non-owner inviting someone who already reaches the target, and anyone granting the Owner", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			await usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: fx.granteeEmail, role: "edit" })
			// The outsider already reaches the Artifact through a Project Grant.
			await usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: "outsider@example.com", role: "view" })

			await expect(
				usecase.create(fx.granteeId, { artifactId: fx.artifactId, granteeEmail: "outsider@example.com", role: "edit" }),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.create(fx.granteeId, { artifactId: fx.artifactId, granteeEmail: "owner@example.com", role: "view" }),
			).rejects.toThrow(REFUSAL_TEXT)
			await expect(
				usecase.create(fx.granteeId, {
					projectId: fx.childProjectId,
					granteeEmail: "outsider@example.com",
					role: "view",
				}),
			).rejects.toThrow(REFUSAL_TEXT)

			// The Owner may still layer an Artifact Grant over a Project one, but never grant themselves.
			await expect(
				usecase.create(fx.ownerId, { artifactId: fx.artifactId, granteeEmail: "outsider@example.com", role: "view" }),
			).resolves.toMatchObject({ granteeId: fx.outsiderId })
			await expect(
				usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: "owner@example.com", role: "view" }),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("hands a pinned inviter's own pin to the person they invite", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const inviter = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "collaborate",
			})
			await usecase.updatePin(fx.ownerId, inviter.id, fx.revisionOneId)

			const invited = await usecase.create(fx.granteeId, {
				artifactId: fx.artifactId,
				granteeEmail: "outsider@example.com",
				role: "view",
			})
			const stored = (await usecase.list(fx.ownerId, { artifactId: fx.artifactId })).find(
				(grant) => grant.id === invited.id,
			)!
			expect(stored.pinnedRevisionId).toBe(fx.revisionOneId)
		})
	})

	it("shows pins only to the Owner", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const own = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "collaborate",
			})
			const other = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: "outsider@example.com",
				role: "view",
			})
			await usecase.updatePin(fx.ownerId, other.id, fx.revisionOneId)

			const asOwner = await usecase.list(fx.ownerId, { artifactId: fx.artifactId })
			expect(asOwner.find((grant) => grant.id === other.id)!.pinnedRevisionId).toBe(fx.revisionOneId)
			const asCollaborator = await usecase.list(fx.granteeId, { artifactId: fx.artifactId })
			expect(asCollaborator.map((grant) => grant.pinnedRevisionId)).toEqual([null, null])
			expect(asCollaborator.map((grant) => grant.id).sort()).toEqual([own.id, other.id].sort())
		})
	})

	it("reports the caller's own access, and leaves a Project-level grantee out of suggestions", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			await usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: fx.granteeEmail, role: "collaborate" })

			await expect(usecase.access(fx.ownerId, { projectId: fx.childProjectId })).resolves.toBe("owner")
			await expect(usecase.access(fx.granteeId, { projectId: fx.childProjectId })).resolves.toBe("collaborate")
			await expect(usecase.access(fx.outsiderId, { projectId: fx.projectId })).resolves.toBeNull()

			const onArtifact = await usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId })
			expect(onArtifact.map((person) => person.id)).toEqual([fx.outsiderId])
			const onChild = await usecase.suggestions(fx.ownerId, { projectId: fx.childProjectId })
			expect(onChild.map((person) => person.id)).toEqual([fx.outsiderId])
		})
	})

	it("matches LIKE wildcards in the suggestion text literally", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			await expect(usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId, query: "%" })).resolves.toEqual([])
			await expect(usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId, query: "_" })).resolves.toEqual([])
			await expect(usecase.suggestions(fx.ownerId, { artifactId: fx.artifactId, query: "outs" })).resolves.toHaveLength(
				1,
			)
		})
	})

	it("refuses a Project invite from someone pinned on a file that Project reaches", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			await usecase.create(fx.ownerId, { projectId: fx.projectId, granteeEmail: fx.granteeEmail, role: "collaborate" })
			const direct = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "collaborate",
			})

			// Unpinned, the Collaborator may share the Project.
			const invited = await usecase.create(fx.granteeId, {
				projectId: fx.projectId,
				granteeEmail: "outsider@example.com",
				role: "view",
			})
			await usecase.remove(fx.ownerId, invited.id)

			await usecase.updatePin(fx.ownerId, direct.id, fx.revisionOneId)
			await expect(
				usecase.create(fx.granteeId, { projectId: fx.projectId, granteeEmail: "outsider@example.com", role: "view" }),
			).rejects.toThrow(REFUSAL_TEXT)
		})
	})

	it("redacts the pin in create's answer to a non-owner", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const usecase = new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql))
			const inviter = await usecase.create(fx.ownerId, {
				artifactId: fx.artifactId,
				granteeEmail: fx.granteeEmail,
				role: "collaborate",
			})
			await usecase.updatePin(fx.ownerId, inviter.id, fx.revisionOneId)

			const answered = await usecase.create(fx.granteeId, {
				artifactId: fx.artifactId,
				granteeEmail: "outsider@example.com",
				role: "view",
			})
			expect(answered.pinnedRevisionId).toBeNull()
			const stored = (await usecase.list(fx.ownerId, { artifactId: fx.artifactId })).find(
				(grant) => grant.id === answered.id,
			)!
			expect(stored.pinnedRevisionId).toBe(fx.revisionOneId)
		})
	})
})
