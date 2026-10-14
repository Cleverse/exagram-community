import { randomUUID } from "node:crypto"

import { NO_COLLABORATOR_IN_PERSONAL } from "@exagram/core/entity/grant"
import { ArtifactsRepository } from "@exagram/core/repository/postgres/artifacts.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { InvitesRepository } from "@exagram/core/repository/postgres/invites.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { McpRepository } from "@exagram/core/repository/postgres/mcp.repository"
import { MembersRepository } from "@exagram/core/repository/postgres/members.repository"
import { PasswordResetsRepository } from "@exagram/core/repository/postgres/password-resets.repository"
import { ProjectsRepository } from "@exagram/core/repository/postgres/projects.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { withDb } from "@exagram/core/test/pg"
import { seedConnection, seedGrant, seedRevision } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { sha256Hex } from "@exagram/core/utils/digest"
import { personalHas } from "@exagram/core/utils/personal-rule"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { noArtifactRedaction } from "./artifacts/artifact-redaction.port"
import { ArtifactsUsecase } from "./artifacts/artifacts.usecase"
import { GrantsUsecase, SHARE_BY_EMAIL_ACTION } from "./grants.usecase"
import { LedgerUsecase } from "./ledger.usecase"
import { McpToolsUsecase } from "./mcp-tools.usecase"
import { answerOf, fixture, refusal, type PersonalRulesFixture } from "./personal-rules.fixtures"
import { ProjectsUsecase } from "./projects/projects.usecase"
import { RevisionsUsecase } from "./revisions/revisions.usecase"
import { FakeJobQueue, FakeObjectStorage } from "./store.datagateway.fake"
import { InvitesUsecase } from "./workspace/invites.usecase"
import { MembersUsecase } from "./workspace/members.usecase"
import { ResetLinksUsecase } from "./workspace/reset-links.usecase"

import type { Sql } from "postgres"

const grantsFor = (sql: Sql) =>
	new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql), {
		tx: new TransactionProvider(sql),
		inviteByEmail: true,
		ledger: new LedgerService(new LedgerRepository(sql)),
	})

const calls = async (sql: Sql, userId: string, action: string) =>
	sql`SELECT 1 FROM exagram.ledger_calls WHERE principal_id = ${userId} AND action = ${action}`

describe("Personal Workspace rules (usecase integration)", () => {
	describe("sharing", () => {
		it("refuses a Collaborator Grant before it spends a share by email, and shares as Viewer or Editor", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const grants = grantsFor(sql)
				for (const granteeEmail of ["friend@acme.test", "stranger@example.com"]) {
					expect(
						await refusal(grants.create(fx.ownerId, { artifactId: fx.fileId, granteeEmail, role: "collaborate" })),
					).toBe(NO_COLLABORATOR_IN_PERSONAL)
				}
				expect(
					await refusal(
						grants.create(fx.ownerId, {
							projectId: fx.projectId,
							granteeEmail: "friend@acme.test",
							role: "collaborate",
						}),
					),
				).toBe(NO_COLLABORATOR_IN_PERSONAL)
				expect(await calls(sql, fx.ownerId, SHARE_BY_EMAIL_ACTION)).toHaveLength(0)

				const viewer = await grants.create(fx.ownerId, {
					artifactId: fx.fileId,
					granteeEmail: "friend@acme.test",
					role: "view",
				})
				expect(viewer.grantee.id).toBe(fx.friendId)
				expect(await refusal(grants.updateRole(fx.ownerId, viewer.id, "collaborate"))).toBe(NO_COLLABORATOR_IN_PERSONAL)
				expect((await grants.updateRole(fx.ownerId, viewer.id, "edit")).role).toBe("edit")
			})
		})

		it("still hands a Team's Collaborator role out", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const grant = await grantsFor(sql).create(fx.bossId, {
					artifactId: fx.teamFileId,
					granteeEmail: "friend@acme.test",
					role: "collaborate",
				})
				expect(grant.role).toBe("collaborate")
			})
		})

		it("shares to an email nobody holds as a bare account with no membership, and frees the email with the last Grant", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const grants = grantsFor(sql)
				const grant = await grants.create(fx.ownerId, {
					artifactId: fx.fileId,
					granteeEmail: "Stranger@Example.com",
					role: "view",
				})
				expect(grant).toMatchObject({ role: "view", grantee: { email: "stranger@example.com", pending: true } })
				expect(await sql`SELECT 1 FROM exagram.memberships WHERE user_id = ${grant.grantee.id}`).toHaveLength(0)
				expect(await calls(sql, fx.ownerId, SHARE_BY_EMAIL_ACTION)).toHaveLength(1)

				await grants.remove(fx.ownerId, grant.id)
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${grant.grantee.id}`).toHaveLength(0)
			})
		})
	})

	describe("Artifacts and folders", () => {
		const artifactsFor = (sql: Sql) => {
			const artifacts = new ArtifactsRepository(sql)
			const projects = new ProjectsRepository(sql)
			const revisions = new RevisionsUsecase(
				artifacts,
				new RevisionsRepository(sql),
				new FakeObjectStorage(),
				buildServeService(sql),
				new TransactionProvider(sql),
				{ maxBytes: 1024, recheckBeforeFinalize: false },
				new FakeJobQueue(),
			)
			return new ArtifactsUsecase(artifacts, projects, revisions, buildServeService(sql), noArtifactRedaction, [
				"restricted",
				"org",
				"anyone",
			])
		}

		it("refuses a Publish Policy on Artifacts and folders", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const projects = new ProjectsUsecase(new ProjectsRepository(sql), fx.tx)

				expect(
					await refusal(
						artifactsFor(sql).setPublishPolicy(fx.owner, { artifactId: fx.fileId, publishPolicy: "manual" }),
					),
				).toBe(personalHas("Publish Policy"))
				expect(
					await refusal(projects.setPublishPolicy(fx.owner, { projectId: fx.projectId, publishPolicy: "manual" })),
				).toBe(personalHas("Publish Policy"))
			})
		})

		it("lets an Artifact be Anyone with the link and refuses everyone in the Workspace", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				await seedRevision(sql, { artifactId: fx.fileId, seq: 1, authorUserId: fx.ownerId })
				const artifacts = artifactsFor(sql)
				expect(
					(await artifacts.setGeneralAccess(fx.owner, { artifactId: fx.fileId, generalAccess: "anyone" }))
						.generalAccess,
				).toBe("anyone")
				expect(
					await refusal(artifacts.setGeneralAccess(fx.owner, { artifactId: fx.fileId, generalAccess: "org" })),
				).toBe("A Personal Workspace cannot open an Artifact to everyone in the Workspace.")
				const [row] = await sql<{ general_access: string }[]>`
					SELECT general_access FROM exagram.artifacts WHERE id = ${fx.fileId}`
				expect(row!.general_access).toBe("anyone")
			})
		})

		it("starts a folder on the generic Link Preview card and keeps it there", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const projects = new ProjectsUsecase(new ProjectsRepository(sql), fx.tx)
				const created = await projects.create(fx.owner, { name: "Fresh", parentProjectId: null })
				expect(created.linkPreview).toBe("generic")
				expect(
					await refusal(projects.setLinkPreview(fx.owner, { projectId: created.id, linkPreview: "metadata" })),
				).toBe("A Personal Workspace shows every Link Preview as the generic card.")
			})
		})
	})

	describe("Team features", () => {
		it("refuses an Invite before it counts against the cap or tells whether the email has an account", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const invites = new InvitesUsecase(
					fx.auth,
					new InvitesRepository(sql),
					new JoiningRepository(sql),
					fx.ledger,
					fx.tx,
					"https://app.example.test",
					new GrantsRepository(sql),
					null,
					() => new Date(),
					{ inviteRoles: ["admin", "member"], membersMayInvite: true },
				)
				for (const email of ["new@example.com", "friend@acme.test"]) {
					expect(await refusal(invites.create(fx.ownerCaller, { email, role: "member" }))).toBe(personalHas("Invites"))
				}
				expect(await sql`SELECT 1 FROM exagram.ledger_calls WHERE principal_id = ${fx.ownerId}`).toHaveLength(0)
			})
		})
	})

	describe("Team administration", () => {
		const membersFor = (sql: Sql, fx: PersonalRulesFixture) =>
			new MembersUsecase(fx.auth, new MembersRepository(sql), fx.ledger, fx.tx, {
				revokeGrant: () => Promise.resolve(),
			})

		it("refuses a Personal Workspace members and Reset Links", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const members = membersFor(sql, fx)
				const resetLinks = new ResetLinksUsecase(
					fx.auth,
					new PasswordResetsRepository(sql),
					fx.ledger,
					fx.tx,
					"https://app.example.test",
					true,
				)

				const attempts: [string, () => Promise<unknown>][] = [
					["Members", () => members.list(fx.ownerCaller)],
					["Members", () => members.setRole(fx.ownerCaller, fx.friendId, "admin")],
					["Members", () => members.remove(fx.ownerCaller, fx.friendId, undefined)],
					["Members", () => members.remove(fx.ownerCaller, fx.friendId, fx.ownerId)],
					["Reset Links", () => resetLinks.createForMember(fx.ownerCaller, "friend@acme.test")],
				]
				for (const [feature, attempt] of attempts) expect(await refusal(attempt())).toBe(personalHas(feature))
			})
		})

		it("answers the Invites list and the Reset Link capability a Personal Admin's settings read as empty and off", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const invites = new InvitesUsecase(
					fx.auth,
					new InvitesRepository(sql),
					new JoiningRepository(sql),
					fx.ledger,
					fx.tx,
					"https://app.example.test",
					new GrantsRepository(sql),
					null,
					() => new Date(),
					{ inviteRoles: ["admin", "member"], membersMayInvite: true },
				)
				const resetLinks = (enabled: boolean) =>
					new ResetLinksUsecase(
						fx.auth,
						new PasswordResetsRepository(sql),
						fx.ledger,
						fx.tx,
						"https://app.example.test",
						enabled,
					)

				expect(await invites.list(fx.ownerAdmin)).toEqual([])
				expect(await resetLinks(true).availableTo(fx.ownerAdmin)).toBe(false)
				expect(await resetLinks(true).availableTo(fx.bossAdmin)).toBe(true)
				expect(await resetLinks(false).availableTo(fx.bossAdmin)).toBe(false)
				expect((await answerOf(resetLinks(true).availableTo({ id: fx.friendId, workspaceId: fx.team }))).message).toBe(
					REFUSAL_TEXT,
				)
			})
		})

		it("leaves a Team's administration alone, and answers someone who is no member as before", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const members = membersFor(sql, fx)

				expect((await members.list(fx.bossCaller)).items.map((member) => member.id)).toContain(fx.bossId)
				expect((await answerOf(members.list({ id: randomUUID(), workspaceId: fx.team }))).message).toBe(REFUSAL_TEXT)
			})
		})

		it("still lets a Personal owner read the Audit", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const ledger = new LedgerUsecase(new LedgerRepository(sql), buildServeService(sql))
				expect(Array.isArray((await ledger.activity(fx.ownerAdmin, { limit: 10 })).items)).toBe(true)
			})
		})
	})

	describe("an outsider", () => {
		it("is told the same about a Personal target as about one that does not exist", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const outsider = (await fx.auth.getUserById(fx.bossId))!
				const grants = grantsFor(sql)
				const grant = await grants.create(fx.ownerId, {
					artifactId: fx.fileId,
					granteeEmail: "friend@acme.test",
					role: "view",
				})
				const projects = new ProjectsUsecase(new ProjectsRepository(sql), fx.tx)
				const artifacts = new ArtifactsUsecase(
					new ArtifactsRepository(sql),
					new ProjectsRepository(sql),
					new RevisionsUsecase(
						new ArtifactsRepository(sql),
						new RevisionsRepository(sql),
						new FakeObjectStorage(),
						buildServeService(sql),
						fx.tx,
						{ maxBytes: 1024, recheckBeforeFinalize: false },
						new FakeJobQueue(),
					),
					buildServeService(sql),
					noArtifactRedaction,
					["restricted", "org", "anyone"],
				)
				const attempts: [string, (id: string) => Promise<unknown>, string][] = [
					[
						"a Collaborator share of an Artifact",
						(id) =>
							grants.create(outsider.id, { artifactId: id, granteeEmail: "friend@acme.test", role: "collaborate" }),
						fx.fileId,
					],
					[
						"a Collaborator share of a folder",
						(id) =>
							grants.create(outsider.id, { projectId: id, granteeEmail: "friend@acme.test", role: "collaborate" }),
						fx.projectId,
					],
					["a role change", (id) => grants.updateRole(outsider.id, id, "collaborate"), grant.id],
					[
						"org General Access",
						(id) => artifacts.setGeneralAccess(outsider, { artifactId: id, generalAccess: "org" }),
						fx.fileId,
					],
					[
						"an Artifact Publish Policy",
						(id) => artifacts.setPublishPolicy(outsider, { artifactId: id, publishPolicy: "manual" }),
						fx.fileId,
					],
					[
						"a folder Publish Policy",
						(id) => projects.setPublishPolicy(outsider, { projectId: id, publishPolicy: "manual" }),
						fx.projectId,
					],
					[
						"a folder Link Preview",
						(id) => projects.setLinkPreview(outsider, { projectId: id, linkPreview: "metadata" }),
						fx.projectId,
					],
				]
				for (const [, attempt, realId] of attempts) {
					const real = await answerOf(attempt(realId))
					const missing = await answerOf(attempt(randomUUID()))
					expect(real).toEqual(missing)
					expect(real.type).not.toBe("PersonalRuleError")
				}
			})
		})
	})

	describe("publishing", () => {
		const revisionsFor = (sql: Sql, storage: FakeObjectStorage) =>
			new RevisionsUsecase(
				new ArtifactsRepository(sql),
				new RevisionsRepository(sql),
				storage,
				buildServeService(sql),
				new TransactionProvider(sql),
				{ maxBytes: 1024, recheckBeforeFinalize: false },
				new FakeJobQueue(),
			)

		const upload = async (
			usecase: RevisionsUsecase,
			storage: FakeObjectStorage,
			user: Parameters<RevisionsUsecase["finalize"]>[0],
			artifactId: string,
		) => {
			const body = `body ${randomUUID()}`
			const ticket = await usecase.createUploadTicket(user, { artifactId, mime: "text/markdown", bytes: body.length })
			storage.seed(ticket.storageKey, body)
			return usecase.finalize(user, {
				artifactId,
				storageKey: ticket.storageKey,
				sha256: sha256Hex(Buffer.from(body)),
				bytes: body.length,
				note: null,
			})
		}

		it("publishes an Editor's upload and the owner's restore on arrival, with no Pending Revision", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const storage = new FakeObjectStorage()
				const usecase = revisionsFor(sql, storage)
				const first = await upload(usecase, storage, fx.owner, fx.fileId)
				expect(first.status).toBe("approved")

				await seedGrant(sql, { artifactId: fx.fileId, granteeId: fx.friendId, createdBy: fx.ownerId, role: "edit" })
				const friend = (await fx.auth.getUserById(fx.friendId))!
				const edited = await upload(usecase, storage, friend, fx.fileId)
				expect(edited.status).toBe("approved")

				const restored = await usecase.restoreAsNew(fx.owner, { artifactId: fx.fileId, revisionId: first.id })
				expect(restored.status).toBe("approved")
				const [row] = await sql<{ current: string; pending: number }[]>`
					SELECT a.current_revision_id AS current,
					       (SELECT count(*)::int FROM exagram.revisions WHERE artifact_id = a.id AND status = 'pending') AS pending
					FROM exagram.artifacts a WHERE a.id = ${fx.fileId}`
				expect(row).toEqual({ current: restored.id, pending: 0 })
			})
		})

		it("holds a Team's restore for the Approver", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const storage = new FakeObjectStorage()
				const usecase = revisionsFor(sql, storage)
				const boss = (await fx.auth.getUserById(fx.bossId))!
				const first = await upload(usecase, storage, boss, fx.teamFileId)
				const restored = await usecase.restoreAsNew(boss, { artifactId: fx.teamFileId, revisionId: first.id })
				expect(restored.status).toBe("pending")
			})
		})

		it("publishes an AI tool's write that quotes a placeholder, and answers its change to Collaborator as refused", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const connectionId = await seedConnection(sql, { userId: fx.ownerId, scopes: ["read", "write", "manage"] })
				const bodies = new Map<string, string>()
				const mcp = new McpToolsUsecase(new McpRepository(sql), {
					read: (storageKey) => Promise.resolve(bodies.get(storageKey) ?? ""),
					write: ({ storageKey, body }) => {
						bodies.set(storageKey, body)
						return Promise.resolve()
					},
					remove: (storageKey) => {
						bodies.delete(storageKey)
						return Promise.resolve()
					},
				})
				const principal = { kind: "connection" as const, id: connectionId, folderAccess: "all" as const }
				const written = await mcp.upload(principal, {
					projectId: fx.projectId,
					kind: "doc",
					title: "Mine",
					content: "Mail [EMAIL] about it.",
					artifactId: fx.fileId,
				})
				expect(written.result?.status).toBe("approved")

				const grantId = await seedGrant(sql, {
					artifactId: fx.fileId,
					granteeId: fx.friendId,
					createdBy: fx.ownerId,
					role: "view",
				})
				expect(await mcp.updateGrantRole(principal, grantId, "collaborate")).toEqual({
					result: null,
					reason: "out-of-boundary",
				})
				expect((await mcp.updateGrantRole(principal, grantId, "edit")).result?.role).toBe("edit")
			})
		})
	})
})
