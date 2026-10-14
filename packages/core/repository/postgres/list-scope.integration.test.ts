import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import {
	approveRevision,
	seedArtifact,
	seedGrant,
	seedMembership,
	seedPersonalWorkspace,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "../../test/seed"

import { AccessRequestsRepository } from "./access-requests.repository"
import { ArtifactsRepository } from "./artifacts.repository"
import { listNotificationsForEmail, NotificationsRepository } from "./notifications.repository"
import { ProjectsRepository } from "./projects.repository"
import { SearchRepository } from "./search.repository"
import { VisibilityRepository } from "./visibility.repository"

import type { NotificationKind, NotificationPreferences } from "../../entity/notification"
import type { Sql } from "postgres"

const EPOCH = new Date(0)

const DEFAULTS: NotificationPreferences = {
	accessRequests: true,
	pendingRevisions: true,
	grants: true,
	comments: true,
	decisions: true,
	published: true,
	connections: true,
	recap: false,
	revisionScope: "member",
	mutedProjectIds: [],
	quietHours: { enabled: true, from: "22:00", to: "08:00", urgent: true },
}

const comment = async (sql: Sql, revisionId: string, authorId: string): Promise<string> =>
	(
		await sql<{ id: string }[]>`
			INSERT INTO exagram.comments (revision_id, author_id, body) VALUES (${revisionId}, ${authorId}, 'x') RETURNING id`
	)[0]!.id

const accessRequest = async (sql: Sql, workspaceId: string, artifactId: string, requesterId: string): Promise<string> =>
	(
		await sql<{ id: string }[]>`
			INSERT INTO exagram.access_requests (workspace_id, artifact_id, requester_id)
			VALUES (${workspaceId}, ${artifactId}, ${requesterId}) RETURNING id`
	)[0]!.id

const sorted = (ids: string[]) => [...ids].sort()

const seedScope = async (sql: Sql) => {
	const published = async (workspaceId: string, ownerId: string, title: string, projectId?: string) => {
		const artifact = await seedArtifact(sql, { workspaceId, ownerId, title, projectId })
		const revision = await seedRevision(sql, { artifactId: artifact, seq: 1, authorUserId: ownerId })
		await approveRevision(sql, artifact, revision)
		return { artifact, revision }
	}
	const pending = (artifactId: string, authorUserId: string) => seedRevision(sql, { artifactId, seq: 2, authorUserId })

	const team = await seedWorkspace(sql, "Acme")
	const ada = await seedUser(sql, { workspaceId: team, email: "ada@acme.test" })
	const bo = await seedUser(sql, { workspaceId: team, email: "bo@acme.test" })
	const personal = await seedPersonalWorkspace(sql, ada)

	const oldTeam = await seedWorkspace(sql, "Old Team")
	const dee = await seedUser(sql, { workspaceId: oldTeam, email: "dee@old.test" })
	await seedMembership(sql, { userId: ada, workspaceId: oldTeam, removed: true })

	const third = await seedWorkspace(sql, "Third")
	const zed = await seedUser(sql, { workspaceId: third, email: "zed@third.test" })

	const teamOwn = await published(team, ada, "Team plan own")
	const teamShared = await published(team, bo, "Team plan shared")
	await published(team, bo, "Team plan hidden")
	const personalOwn = await published(personal, ada, "Personal plan own")
	const oldOwn = await published(oldTeam, ada, "Old plan own")
	const guestFile = await published(third, zed, "Guest plan file")

	const teamFolder = await seedProject(sql, { workspaceId: team, ownerId: ada, name: "Team folder" })
	const boFolder = await seedProject(sql, { workspaceId: team, ownerId: bo, name: "Bo folder" })
	const personalFolder = await seedProject(sql, { workspaceId: personal, ownerId: ada, name: "Personal folder" })
	await seedProject(sql, { workspaceId: oldTeam, ownerId: ada, name: "Old folder" })
	const guestFolder = await seedProject(sql, { workspaceId: third, ownerId: zed, name: "Guest folder" })

	const teamSharedGrant = await seedGrant(sql, {
		artifactId: teamShared.artifact,
		granteeId: ada,
		createdBy: bo,
		role: "view",
	})
	const boFolderGrant = await seedGrant(sql, { projectId: boFolder, granteeId: ada, createdBy: bo, role: "view" })
	const guestFileGrant = await seedGrant(sql, {
		artifactId: guestFile.artifact,
		granteeId: ada,
		createdBy: zed,
		role: "edit",
	})
	const guestFolderGrant = await seedGrant(sql, {
		projectId: guestFolder,
		granteeId: ada,
		createdBy: zed,
		role: "view",
	})
	await seedGrant(sql, { artifactId: personalOwn.artifact, granteeId: zed, createdBy: ada, role: "edit" })

	return {
		team,
		personal,
		oldTeam,
		third,
		ada,
		bo,
		dee,
		zed,
		artifacts: { teamOwn, teamShared, personalOwn, oldOwn, guestFile },
		folders: { teamFolder, boFolder, personalFolder, guestFolder },
		grants: { teamSharedGrant, boFolderGrant, guestFileGrant, guestFolderGrant },
		pending: {
			team: await pending(teamOwn.artifact, bo),
			personal: await pending(personalOwn.artifact, zed),
			old: await pending(oldOwn.artifact, dee),
			guest: await pending(guestFile.artifact, ada),
		},
		comments: {
			team: await comment(sql, teamOwn.revision, bo),
			personal: await comment(sql, personalOwn.revision, zed),
			old: await comment(sql, oldOwn.revision, dee),
			guest: await comment(sql, guestFile.revision, zed),
		},
		requests: {
			team: await accessRequest(sql, team, teamOwn.artifact, bo),
			old: await accessRequest(sql, oldTeam, oldOwn.artifact, dee),
		},
	}
}

describe("Artifact lists of one Workspace", () => {
	it.each(["all", "mine", "sharedWithMe"] as const)("list only the requested Workspace's rows for scope %s", (scope) =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const list = async (workspaceId: string) =>
				(await new ArtifactsRepository(sql).listVisible({ kind: "user", id: world.ada }, { workspaceId, scope })).map(
					(row) => row.id,
				)
			const { teamOwn, teamShared, personalOwn, guestFile } = world.artifacts

			// A Guest's file belongs in the Personal Workspace, never in the Team the person is a member of.
			const expected = {
				all: { team: [teamOwn.artifact, teamShared.artifact], personal: [personalOwn.artifact, guestFile.artifact] },
				mine: { team: [teamOwn.artifact], personal: [personalOwn.artifact] },
				sharedWithMe: { team: [teamShared.artifact], personal: [guestFile.artifact] },
			}[scope]
			expect(sorted(await list(world.team))).toEqual(sorted(expected.team))
			expect(sorted(await list(world.personal))).toEqual(sorted(expected.personal))
		}),
	)

	it("show a Guest's file in the Personal Workspace only, and keep a file the person owns in a Team they left out of both", () =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const principal = { kind: "user" as const, id: world.ada }
			const repo = new ArtifactsRepository(sql)
			const { guestFile, oldOwn } = world.artifacts

			const listed = async (workspaceId: string) =>
				(await repo.listVisible(principal, { workspaceId, scope: "all" })).map((row) => row.id)
			expect(await listed(world.team)).not.toContain(guestFile.artifact)
			expect(await listed(world.personal)).toContain(guestFile.artifact)
			for (const workspaceId of [world.team, world.personal]) {
				expect(await listed(workspaceId)).not.toContain(oldOwn.artifact)
			}
			expect(await repo.getVisible(principal, guestFile.artifact)).toMatchObject({
				id: guestFile.artifact,
				access: "edit",
			})
		}))

	it("are matched by search only inside the requested Workspace", () =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const search = async (workspaceId: string) =>
				(
					await new SearchRepository(sql).search({
						principalKind: "user",
						principalId: world.ada,
						surface: "web",
						workspaceId,
						query: "plan",
						limit: 50,
					})
				).map((hit) => hit.artifactId)
			const { teamOwn, teamShared, personalOwn, guestFile } = world.artifacts

			expect(sorted(await search(world.team))).toEqual(sorted([teamOwn.artifact, teamShared.artifact]))
			expect(sorted(await search(world.personal))).toEqual(sorted([personalOwn.artifact, guestFile.artifact]))
		}))
})

describe("Project, pending Revision and Access Request lists of one Workspace", () => {
	it("list the Projects of the requested Workspace the person owns or a Grant reaches", () =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const names = async (workspaceId: string) =>
				(await new ProjectsRepository(sql).listVisible(world.ada, workspaceId)).map((project) => project.name).sort()

			expect(await names(world.team)).toEqual(["Bo folder", "Team folder"])
			expect(await names(world.personal)).toEqual(["Guest folder", "Personal folder"])
		}))

	it("list the Revisions waiting in the requested Workspace and none written as a Guest", () =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const pending = async (workspaceId: string) =>
				(await new VisibilityRepository(sql).listPendingRevisions(world.ada, workspaceId)).map((row) => row.revisionId)

			expect(await pending(world.team)).toEqual([world.pending.team])
			expect(await pending(world.personal)).toEqual([world.pending.personal])
		}))

	it("list the open Access Requests on the owner's files of the requested Workspace", () =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const open = async (workspaceId: string) =>
				(await new AccessRequestsRepository(sql).listOpenForOwner(world.ada, workspaceId)).map((row) => row.id)

			expect(await open(world.team)).toEqual([world.requests.team])
			expect(await open(world.personal)).toEqual([])
			expect(await open(world.oldTeam)).toEqual([world.requests.old])
		}))
})

describe("the notification feed of one Workspace", () => {
	const ids = (items: Array<{ id: string; kind: NotificationKind }>, kind: NotificationKind) =>
		sorted(items.filter((item) => item.kind === kind).map((item) => item.id))

	it("holds the Workspace's pending Revisions, Grants, comments and Access Requests and nothing of another", () =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const feed = (workspaceId: string) =>
				new NotificationsRepository(sql).listSince(world.ada, { notBefore: EPOCH, after: null, workspaceId }, 100)

			const inTeam = await feed(world.team)
			expect(ids(inTeam, "pendingRevision")).toEqual([world.pending.team])
			expect(ids(inTeam, "grant")).toEqual(sorted([world.grants.teamSharedGrant, world.grants.boFolderGrant]))
			expect(ids(inTeam, "comment")).toEqual([world.comments.team])
			expect(ids(inTeam, "accessRequest")).toEqual([world.requests.team])

			// What another Workspace shares with the person as a Guest is heard in their Personal Workspace.
			const inPersonal = await feed(world.personal)
			expect(ids(inPersonal, "pendingRevision")).toEqual([world.pending.personal])
			expect(ids(inPersonal, "grant")).toEqual(sorted([world.grants.guestFileGrant, world.grants.guestFolderGrant]))
			expect(ids(inPersonal, "comment")).toEqual(sorted([world.comments.personal, world.comments.guest]))
			expect(ids(inPersonal, "accessRequest")).toEqual([])

			const elsewhere = [world.pending.guest, world.pending.old, world.comments.old, world.requests.old]
			for (const items of [inTeam, inPersonal]) {
				expect(items.map((item) => item.id).filter((id) => elsewhere.includes(id))).toEqual([])
			}
			const guestItems = [world.grants.guestFileGrant, world.grants.guestFolderGrant, world.comments.guest]
			expect(inTeam.map((item) => item.id).filter((id) => guestItems.includes(id))).toEqual([])
		}))

	it("is read across Workspaces by the Notification Email query", () =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const everything = await listNotificationsForEmail(
				sql,
				world.ada,
				{ notBefore: EPOCH, after: null, notAfter: null },
				{ ...DEFAULTS },
				100,
			)

			expect(ids(everything, "comment")).toEqual(
				sorted([world.comments.team, world.comments.personal, world.comments.old, world.comments.guest]),
			)
		}))
})

describe("muted folders of one Workspace", () => {
	it("are saved and listed per Workspace, and saving one leaves the other's muted", () =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const repo = new NotificationsRepository(sql)
			const { teamFolder, personalFolder } = world.folders

			await repo.setPreferences(world.ada, world.team, { ...DEFAULTS, mutedProjectIds: [teamFolder] })
			await repo.setPreferences(world.ada, world.personal, { ...DEFAULTS, mutedProjectIds: [personalFolder] })
			expect((await repo.getPreferences(world.ada, world.team))!.mutedProjectIds).toEqual([teamFolder])
			expect((await repo.getPreferences(world.ada, world.personal))!.mutedProjectIds).toEqual([personalFolder])

			await repo.setPreferences(world.ada, world.team, { ...DEFAULTS, mutedProjectIds: [] })
			expect((await repo.getPreferences(world.ada, world.team))!.mutedProjectIds).toEqual([])
			expect((await repo.getPreferences(world.ada, world.personal))!.mutedProjectIds).toEqual([personalFolder])
		}))

	it("never store a folder of another Workspace, even one the person reaches", () =>
		withDb(async (sql) => {
			const world = await seedScope(sql)
			const repo = new NotificationsRepository(sql)
			const { teamFolder, personalFolder } = world.folders

			const saved = await repo.setPreferences(world.ada, world.personal, {
				...DEFAULTS,
				mutedProjectIds: [teamFolder, personalFolder],
			})
			expect(saved.mutedProjectIds).toEqual([personalFolder])
			expect(await sql`SELECT project_id FROM exagram.notification_muted_projects`).toEqual([
				{ project_id: personalFolder },
			])
		}))
})
