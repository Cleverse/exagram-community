import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { withDb } from "../../test/pg"
import { untilLockWaits } from "../../test/removal-race"
import { seedMembership, seedPersonalWorkspace, seedUser, seedWorkspace } from "../../test/seed"
import { RefusalError } from "../../utils/refusal"

import { AuthRepository } from "./auth.repository"
import { TransactionProvider } from "./db"
import { MembersRepository } from "./members.repository"

import type { Sql } from "postgres"

const LOW = "00000000-0000-4000-8000-000000000001"
const HIGH = "ffffffff-ffff-4fff-8fff-ffffffffffff"
const TOKEN = "a".repeat(64)
const inAnHour = () => new Date(Date.now() + 3_600_000)

const seedAda = async (
	sql: Sql,
	opts: { teamId?: string; personalId?: string; teamAdmin?: boolean; personalAdmin?: boolean } = {},
) => {
	const team = await seedWorkspace(sql, "Acme", opts.teamId)
	const ada = await seedUser(sql, { workspaceId: team, email: "ada@acme.test", isAdmin: opts.teamAdmin })
	const personal = await seedPersonalWorkspace(sql, ada, { id: opts.personalId, isAdmin: opts.personalAdmin })
	return { team, personal, ada }
}

const open = async (repo: AuthRepository, userId: string, tokenHash = TOKEN) => {
	await repo.createSession({ userId, tokenHash, expiresAt: inAnHour() })
	return (await repo.getUserBySessionTokenHash(tokenHash))!
}

const storedWorkspace = async (sql: Sql, tokenHash = TOKEN) =>
	(
		await sql<
			{ workspaceId: string }[]
		>`SELECT workspace_id AS "workspaceId" FROM exagram.sessions WHERE token_hash = ${tokenHash}`
	)[0]!.workspaceId

const removeMembership = (sql: Sql, userId: string, workspaceId: string) =>
	sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${userId} AND workspace_id = ${workspaceId}`

describe("AuthRepository.createSession", () => {
	it.each([
		["the Team's id sorts first", LOW, HIGH],
		["the Personal Workspace's id sorts first", HIGH, LOW],
	])("opens in the live Team of a person who also has a Personal Workspace, when %s", (_name, teamId, personalId) =>
		withDb(async (sql) => {
			const { team, ada } = await seedAda(sql, { teamId, personalId })
			expect((await open(new AuthRepository(sql), ada)).workspaceId).toBe(team)
		}),
	)

	it.each([
		["removed", { removed: true }],
		["only invited", { invited: true }],
	])("opens in the Personal Workspace when the Team membership is %s", (_name, state) =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql)
			await seedMembership(sql, { userId: ada, workspaceId: team, ...state })
			expect((await open(new AuthRepository(sql), ada)).workspaceId).toBe(personal)
		}),
	)

	it("refuses a person with no live membership and writes no session", () =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql)
			await seedMembership(sql, { userId: ada, workspaceId: team, removed: true })
			await seedMembership(sql, { userId: ada, workspaceId: personal, invited: true })

			await expect(
				new AuthRepository(sql).createSession({ userId: ada, tokenHash: TOKEN, expiresAt: inAnHour() }),
			).rejects.toBeInstanceOf(RefusalError)
			expect(await sql`SELECT 1 FROM exagram.sessions`).toHaveLength(0)
		}))
})

describe("AuthRepository.switchSessionWorkspace", () => {
	it("moves a session between the Workspaces its person is a live member of", () =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql)
			const repo = new AuthRepository(sql)
			const session = await open(repo, ada)

			expect(
				await repo.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId: personal }),
			).toBe(true)
			expect((await repo.getUserBySessionTokenHash(TOKEN))!.workspaceId).toBe(personal)
			expect(await repo.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId: team })).toBe(
				true,
			)
			expect((await repo.getUserBySessionTokenHash(TOKEN))!.workspaceId).toBe(team)
		}))

	it("answers false and moves nothing for a Workspace the person cannot act in, whatever the reason", () =>
		withDb(async (sql) => {
			const { team, ada } = await seedAda(sql)
			const repo = new AuthRepository(sql)
			const foreign = await seedWorkspace(sql, "Elsewhere")
			const invitedTo = await seedWorkspace(sql, "Invited")
			await seedMembership(sql, { userId: ada, workspaceId: invitedTo, invited: true })
			const removedFrom = await seedWorkspace(sql, "Removed")
			await seedMembership(sql, { userId: ada, workspaceId: removedFrom, removed: true })
			const session = await open(repo, ada)

			const answers = []
			for (const workspaceId of [foreign, randomUUID(), invitedTo, removedFrom]) {
				answers.push(await repo.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId }))
				expect(await storedWorkspace(sql)).toBe(team)
			}
			expect(answers).toEqual([false, false, false, false])
		}))

	it("answers false for the Team a person was removed from, and leaves the session in the Personal Workspace", () =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql)
			const repo = new AuthRepository(sql)
			const session = await open(repo, ada)
			await repo.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId: personal })
			await removeMembership(sql, ada, team)

			expect(await repo.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId: team })).toBe(
				false,
			)
			expect(await storedWorkspace(sql)).toBe(personal)
		}))

	it("never moves a session its caller does not own", () =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql)
			const bo = await seedUser(sql, { workspaceId: team, email: "bo@acme.test" })
			await seedPersonalWorkspace(sql, bo)
			const repo = new AuthRepository(sql)
			const boSession = await open(repo, bo, "b".repeat(64))

			expect(
				await repo.switchSessionWorkspace({ sessionId: boSession.sessionId, userId: ada, workspaceId: personal }),
			).toBe(false)
			expect(await storedWorkspace(sql, "b".repeat(64))).toBe(team)
		}))
})

describe("getUserBySessionTokenHash", () => {
	it.each([
		["an admin of the Team and a member of the Personal Workspace", true, false],
		["a member of the Team and an admin of the Personal Workspace", false, true],
	])("answers with the role of the session's Workspace for %s", (_name, teamAdmin, personalAdmin) =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql, { teamAdmin, personalAdmin })
			const repo = new AuthRepository(sql)
			const inTeam = await open(repo, ada)
			expect(inTeam).toMatchObject({ id: ada, workspaceId: team, isAdmin: teamAdmin })

			await repo.switchSessionWorkspace({ sessionId: inTeam.sessionId, userId: ada, workspaceId: personal })
			const inPersonal = (await repo.getUserBySessionTokenHash(TOKEN))!
			expect(inPersonal).toMatchObject({ id: ada, workspaceId: personal, isAdmin: personalAdmin })

			const [stored] = await sql<{ id: string }[]>`SELECT id FROM exagram.sessions WHERE token_hash = ${TOKEN}`
			expect(inPersonal.sessionId).toBe(stored!.id)
			expect(inTeam.sessionId).toBe(stored!.id)

			await repo.switchSessionWorkspace({ sessionId: inTeam.sessionId, userId: ada, workspaceId: team })
			expect(await repo.getUserBySessionTokenHash(TOKEN)).toMatchObject({ workspaceId: team, isAdmin: teamAdmin })
		}),
	)

	it("answers nothing once the person is removed from the session's Workspace, though another membership is live", () =>
		withDb(async (sql) => {
			const { personal, ada } = await seedAda(sql)
			const repo = new AuthRepository(sql)
			const session = await open(repo, ada)
			await repo.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId: personal })
			await removeMembership(sql, ada, personal)

			expect(await repo.getUserBySessionTokenHash(TOKEN)).toBeNull()
		}))

	it("marks Last active only on the membership of the session's Workspace", () =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql)
			const repo = new AuthRepository(sql)
			const lastSeen = async (workspaceId: string) =>
				(
					await sql<{ lastSeenAt: Date | null }[]>`
						SELECT last_seen_at AS "lastSeenAt" FROM exagram.memberships
						WHERE user_id = ${ada} AND workspace_id = ${workspaceId}`
				)[0]!.lastSeenAt

			await repo.createSession({ userId: ada, tokenHash: TOKEN, expiresAt: inAnHour() })
			const [stored] = await sql<{ id: string }[]>`SELECT id FROM exagram.sessions WHERE token_hash = ${TOKEN}`
			await repo.switchSessionWorkspace({ sessionId: stored!.id, userId: ada, workspaceId: personal })
			await repo.getUserBySessionTokenHash(TOKEN)
			expect(await lastSeen(personal)).toBeInstanceOf(Date)
			expect(await lastSeen(team)).toBeNull()

			await repo.switchSessionWorkspace({ sessionId: stored!.id, userId: ada, workspaceId: team })
			await repo.getUserBySessionTokenHash(TOKEN)
			expect(await lastSeen(team)).toBeInstanceOf(Date)
		}))
})

describe("AuthRepository.listLiveWorkspaces", () => {
	it("lists the Personal Workspace first, then the Team, with the person's role in each", () =>
		withDb(async (sql) => {
			const team = await seedWorkspace(sql, "Acme")
			const ada = await seedUser(sql, { workspaceId: team, email: "ada@acme.test", isAdmin: true })
			const personal = await seedPersonalWorkspace(sql, ada, { name: "Zed's files" })

			expect(await new AuthRepository(sql).listLiveWorkspaces(ada)).toEqual([
				{ id: personal, kind: "personal", name: "Zed's files", role: "member" },
				{ id: team, kind: "team", name: "Acme", role: "admin" },
			])
		}))

	it("leaves out a Workspace the person was removed from and one they are only invited to", () =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql)
			const repo = new AuthRepository(sql)
			const invitedTo = await seedWorkspace(sql, "Invited")
			await seedMembership(sql, { userId: ada, workspaceId: invitedTo, invited: true })
			expect((await repo.listLiveWorkspaces(ada)).map((workspace) => workspace.id)).toEqual([personal, team])

			await removeMembership(sql, ada, team)
			expect((await repo.listLiveWorkspaces(ada)).map((workspace) => workspace.id)).toEqual([personal])

			await removeMembership(sql, ada, personal)
			expect(await repo.listLiveWorkspaces(ada)).toEqual([])
		}))
})

describe("a removal racing a switch", () => {
	const race = (removalCommits: boolean) =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql)
			const repo = new AuthRepository(sql)
			const session = await open(repo, ada)
			await repo.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId: personal })

			const rollback = new Error("the removal rolled back")
			let release = () => {}
			const released = new Promise<void>((resolve) => (release = resolve))
			let holding = () => {}
			const holds = new Promise<void>((resolve) => (holding = resolve))
			const removal = sql
				.begin(async (tx) => {
					await tx`SELECT 1 FROM exagram.memberships WHERE user_id = ${ada} AND workspace_id = ${team} FOR NO KEY UPDATE`
					holding()
					await released
					if (!removalCommits) throw rollback
					await tx`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${ada} AND workspace_id = ${team}`
				})
				.catch((error: unknown) => {
					if (error !== rollback) throw error
				})
			await holds

			try {
				let settled = false
				const switched = repo
					.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId: team })
					.finally(() => (settled = true))
				await untilLockWaits(sql, 1)
				expect(settled).toBe(false)

				release()
				await removal
				expect(await switched).toBe(!removalCommits)
				expect(await storedWorkspace(sql)).toBe(removalCommits ? personal : team)
			} finally {
				release()
				await removal
			}
		})

	it("ends a session the switch moved into the Team first, once the removal gets its turn", () =>
		withDb(async (sql) => {
			const { team, personal, ada } = await seedAda(sql)
			const repo = new AuthRepository(sql)
			const session = await open(repo, ada)
			await repo.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId: personal })

			let release = () => {}
			const released = new Promise<void>((resolve) => (release = resolve))
			let holding = () => {}
			const holds = new Promise<void>((resolve) => (holding = resolve))
			const hold = sql.begin(async (tx) => {
				await tx`SELECT 1 FROM exagram.sessions WHERE id = ${session.sessionId} FOR UPDATE`
				holding()
				await released
			})
			await holds

			try {
				const switched = repo.switchSessionWorkspace({ sessionId: session.sessionId, userId: ada, workspaceId: team })
				await untilLockWaits(sql, 1)
				const members = new MembersRepository(sql)
				const removed = new TransactionProvider(sql).atomic(async () => {
					await members.lockTeamChange(team, [ada])
					await members.remove({ userId: ada, workspaceId: team })
				})
				await untilLockWaits(sql, 2)

				release()
				await hold
				expect(await switched).toBe(true)
				await removed
				expect(await sql`SELECT 1 FROM exagram.sessions WHERE user_id = ${ada}`).toHaveLength(0)
			} finally {
				release()
				await hold
			}
		}))

	it("waits for the removal and answers false when it commits", () => race(true))

	it("waits for the removal and moves the session when it rolls back", () => race(false))
})
