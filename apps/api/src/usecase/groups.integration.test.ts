import { randomUUID } from "node:crypto"

import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GroupsRepository } from "@exagram/core/repository/postgres/groups.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { MembersRepository } from "@exagram/core/repository/postgres/members.repository"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { withDb } from "@exagram/core/test/pg"
import { raceRemoval, untilLockWaits } from "@exagram/core/test/removal-race"
import {
	dropPersonalWorkspace,
	seedMembership,
	seedPersonalWorkspace,
	seedUser,
	seedWorkspace,
} from "@exagram/core/test/seed"
import { ConflictError, PersonalRuleError } from "@exagram/core/utils/errors"
import { asPersonalRuleError, personalHas } from "@exagram/core/utils/personal-rule"
import { REFUSAL_TEXT, RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { GroupsUsecase } from "./groups.usecase"
import { MembersUsecase } from "./workspace/members.usecase"

import type { Sql } from "postgres"

const groupsFor = (sql: Sql) =>
	new GroupsUsecase(
		new AuthRepository(sql),
		new GroupsRepository(sql),
		new MembersRepository(sql),
		new LedgerService(new LedgerRepository(sql)),
		new TransactionProvider(sql),
	)

const membersFor = (sql: Sql) =>
	new MembersUsecase(
		new AuthRepository(sql),
		new MembersRepository(sql),
		new LedgerService(new LedgerRepository(sql)),
		new TransactionProvider(sql),
		{ revokeGrant: () => Promise.resolve() },
	)

const team = async (sql: Sql) => {
	const acme = await seedWorkspace(sql, "Acme")
	const as = (id: string, workspaceId = acme) => ({ id, workspaceId })
	const ada = await seedUser(sql, { workspaceId: acme, email: "ada@acme.test", name: "Ada", isAdmin: true })
	const bo = await seedUser(sql, { workspaceId: acme, email: "bo@acme.test", name: "Bo" })
	const cy = await seedUser(sql, { workspaceId: acme, email: "cy@acme.test", name: "Cy" })
	const other = await seedWorkspace(sql, "Other")
	const sam = await seedUser(sql, { workspaceId: other, email: "sam@other.test", name: "Sam", isAdmin: true })
	return { acme, other, ada, bo, cy, sam, as }
}

const errorOf = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	)
	expect(error).toBeInstanceOf(Error)
	return { type: (error as Error).constructor.name, message: (error as Error).message }
}

const personalRule = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	)
	const rule = error instanceof PersonalRuleError ? error : asPersonalRuleError(error)
	expect(rule).not.toBeNull()
	return rule!.message
}

const groupCalls = (sql: Sql) =>
	sql<{ action: string; subject: string | null; status: string; workspaceId: string | null }[]>`
		SELECT action, subject, status, workspace_id AS "workspaceId" FROM exagram.ledger_calls
		WHERE action LIKE 'workspace.group.%' ORDER BY started_at, action
	`

const groupRows = async (sql: Sql) =>
	(await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM exagram.groups`)[0]!.total

describe("Groups (integration)", () => {
	it("creates a Group that every Member lists, with member ids for Admins only", async () => {
		await withDb(async (sql) => {
			const { acme, ada, bo, cy, as } = await team(sql)
			const groups = groupsFor(sql)

			const created = await groups.create(as(ada), { name: "Design", memberIds: [bo, cy, bo] })

			expect(created).toEqual({
				id: created.id,
				name: "Design",
				memberCount: 2,
				memberIds: [bo, cy],
			})
			expect(await groups.list(as(ada))).toEqual({ view: "admin", items: [created] })
			expect(await groups.list(as(bo))).toEqual({
				view: "member",
				items: [{ id: created.id, name: "Design", memberCount: 2 }],
			})
			expect(await groupCalls(sql)).toEqual([
				{ action: "workspace.group.create", subject: created.id, status: "delivered", workspaceId: acme },
			])
		})
	})

	it("renames and replaces the members on update, and deletes with its memberships", async () => {
		await withDb(async (sql) => {
			const { acme, ada, bo, cy, as } = await team(sql)
			const groups = groupsFor(sql)
			const { id } = await groups.create(as(ada), { name: "Design", memberIds: [bo, cy] })

			const updated = await groups.update(as(ada), id, { name: "Brand", memberIds: [ada] })
			expect(updated).toEqual({ id, name: "Brand", memberCount: 1, memberIds: [ada] })

			expect(await groups.delete(as(ada), id)).toEqual({ id })
			expect((await groups.list(as(ada))).items).toEqual([])
			expect(await sql`SELECT 1 FROM exagram.group_members WHERE group_id = ${id}`).toHaveLength(0)
			expect(await groupCalls(sql)).toEqual([
				{ action: "workspace.group.create", subject: id, status: "delivered", workspaceId: acme },
				{ action: "workspace.group.update", subject: id, status: "delivered", workspaceId: acme },
				{ action: "workspace.group.delete", subject: id, status: "delivered", workspaceId: acme },
			])
		})
	})

	it("treats a member id in capitals as the same person", async () => {
		await withDb(async (sql) => {
			const { ada, bo, as } = await team(sql)

			const created = await groupsFor(sql).create(as(ada), {
				name: "Design",
				memberIds: [bo.toUpperCase(), bo],
			})

			expect(created.memberIds).toEqual([bo])
		})
	})

	it("refuses a second Group with the same name, whatever its case, on create and on rename", async () => {
		await withDb(async (sql) => {
			const { ada, bo, as } = await team(sql)
			const groups = groupsFor(sql)
			await groups.create(as(ada), { name: "Design", memberIds: [bo] })
			const brand = await groups.create(as(ada), { name: "Brand", memberIds: [bo] })

			await expect(groups.create(as(ada), { name: "design", memberIds: [bo] })).rejects.toBeInstanceOf(ConflictError)
			await expect(groups.update(as(ada), brand.id, { name: "DESIGN", memberIds: [bo] })).rejects.toBeInstanceOf(
				ConflictError,
			)
			expect(await groupRows(sql)).toBe(2)
			expect((await groups.list(as(ada))).items.map((group) => group.name)).toEqual(["Brand", "Design"])
		})
	})

	it("lets only Admins write, refusing a Member as if the Group were missing", async () => {
		await withDb(async (sql) => {
			const { ada, bo, cy, as } = await team(sql)
			const groups = groupsFor(sql)
			const { id } = await groups.create(as(ada), { name: "Design", memberIds: [bo] })
			const missing = randomUUID()

			const create = await errorOf(groups.create(as(bo), { name: "Mine", memberIds: [cy] }))
			const update = await errorOf(groups.update(as(bo), id, { name: "Mine", memberIds: [cy] }))
			const remove = await errorOf(groups.delete(as(bo), id))

			expect(create).toEqual({ type: RefusalError.name, message: REFUSAL_TEXT })
			expect(update).toEqual(await errorOf(groups.update(as(ada), missing, { name: "Mine", memberIds: [cy] })))
			expect(remove).toEqual(await errorOf(groups.delete(as(ada), missing)))
			expect((await groups.list(as(ada))).items).toEqual([{ id, name: "Design", memberCount: 1, memberIds: [bo] }])
			expect((await groupCalls(sql)).map((call) => call.action)).toEqual(["workspace.group.create"])
		})
	})

	it("refuses another Workspace's member ids and Groups exactly like missing ones", async () => {
		await withDb(async (sql) => {
			const { other, ada, bo, sam, as } = await team(sql)
			const groups = groupsFor(sql)
			const { id } = await groups.create(as(ada), { name: "Design", memberIds: [bo] })
			const theirs = await groups.create(as(sam, other), { name: "Theirs", memberIds: [sam] })

			const foreignMember = await errorOf(groups.create(as(ada), { name: "Mixed", memberIds: [bo, sam] }))
			const missingMember = await errorOf(groups.create(as(ada), { name: "Mixed", memberIds: [bo, randomUUID()] }))
			expect(foreignMember).toEqual(missingMember)
			expect(foreignMember.type).toBe(RefusalError.name)
			expect(await errorOf(groups.update(as(ada), id, { name: "Design", memberIds: [sam] }))).toEqual(missingMember)

			const foreignGroup = await errorOf(groups.delete(as(ada), theirs.id))
			expect(foreignGroup).toEqual(await errorOf(groups.delete(as(ada), randomUUID())))
			expect(await errorOf(groups.update(as(ada), theirs.id, { name: "Mine", memberIds: [bo] }))).toEqual(
				await errorOf(groups.update(as(ada), randomUUID(), { name: "Mine", memberIds: [bo] })),
			)
			expect((await groups.list(as(sam, other))).items.map((group) => group.name)).toEqual(["Theirs"])
			expect((await groups.list(as(ada))).items).toEqual([{ id, name: "Design", memberCount: 1, memberIds: [bo] }])
		})
	})

	it("refuses someone who is no live Member of the Workspace the session acts in, on a read as on a write", async () => {
		await withDb(async (sql) => {
			const { acme, other, ada, bo, sam, as } = await team(sql)
			const groups = groupsFor(sql)
			await seedMembership(sql, { userId: bo, workspaceId: acme, removed: true })
			const invited = await seedUser(sql, { workspaceId: acme, email: "ivy@acme.test", name: "Ivy" })
			await seedMembership(sql, { userId: invited, workspaceId: acme, invited: true })

			const outsiders = [as(bo), as(invited), as(sam), as(ada, other), as(randomUUID())]
			for (const caller of outsiders) {
				const answers = [
					await errorOf(groups.list(caller)),
					await errorOf(groups.create(caller, { name: "Mine", memberIds: [ada] })),
					await errorOf(groups.update(caller, randomUUID(), { name: "Mine", memberIds: [ada] })),
					await errorOf(groups.delete(caller, randomUUID())),
				]
				for (const answer of answers) expect(answer).toEqual({ type: RefusalError.name, message: REFUSAL_TEXT })
			}
			expect(await groupRows(sql)).toBe(0)
		})
	})

	it("counts a Removed or Invited Member for nothing, even if a row of theirs is still there", async () => {
		await withDb(async (sql) => {
			const { acme, ada, bo, cy, as } = await team(sql)
			const groups = groupsFor(sql)
			const invited = await seedUser(sql, { workspaceId: acme, email: "ivy@acme.test", name: "Ivy" })
			const { id } = await groups.create(as(ada), { name: "Design", memberIds: [cy] })
			await seedMembership(sql, { userId: bo, workspaceId: acme, removed: true })
			await seedMembership(sql, { userId: invited, workspaceId: acme, invited: true })
			await sql`INSERT INTO exagram.group_members (group_id, user_id) VALUES (${id}, ${bo}), (${id}, ${invited})`

			expect(await groups.list(as(cy))).toEqual({ view: "member", items: [{ id, name: "Design", memberCount: 1 }] })
			expect((await groups.list(as(ada))).items).toEqual([{ id, name: "Design", memberCount: 1, memberIds: [cy] }])
			await expect(groups.update(as(ada), id, { name: "Design", memberIds: [bo] })).rejects.toBeInstanceOf(RefusalError)
			await expect(groups.update(as(ada), id, { name: "Design", memberIds: [invited] })).rejects.toBeInstanceOf(
				RefusalError,
			)
		})
	})

	it("drops a removed Member from every Group and refuses them as a new member", async () => {
		await withDb(async (sql) => {
			const { ada, bo, cy, as } = await team(sql)
			const groups = groupsFor(sql)
			const { id } = await groups.create(as(ada), { name: "Design", memberIds: [bo, cy] })

			await membersFor(sql).remove(as(ada), bo, undefined)

			expect(await sql`SELECT 1 FROM exagram.group_members WHERE user_id = ${bo}`).toHaveLength(0)
			expect((await groups.list(as(ada))).items).toEqual([{ id, name: "Design", memberCount: 1, memberIds: [cy] }])
			await expect(groups.update(as(ada), id, { name: "Design", memberIds: [bo] })).rejects.toBeInstanceOf(RefusalError)
		})
	})

	it("ends a person's place in the Groups when anything ends their membership, so a rejoin does not bring them back", async () => {
		await withDb(async (sql) => {
			const { acme, ada, bo, cy, as } = await team(sql)
			const groups = groupsFor(sql)
			const { id } = await groups.create(as(ada), { name: "Design", memberIds: [bo, cy] })

			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${bo} AND workspace_id = ${acme}`
			await sql`UPDATE exagram.memberships SET removed_at = NULL WHERE user_id = ${bo} AND workspace_id = ${acme}`
			expect((await groups.list(as(ada))).items).toEqual([{ id, name: "Design", memberCount: 1, memberIds: [cy] }])

			await sql`UPDATE exagram.memberships SET invited_at = now() WHERE user_id = ${cy} AND workspace_id = ${acme}`
			await sql`UPDATE exagram.memberships SET invited_at = NULL WHERE user_id = ${cy} AND workspace_id = ${acme}`
			expect(await sql`SELECT 1 FROM exagram.group_members`).toHaveLength(0)
		})
	})

	it("ends a person's place in this Team's Groups only", async () => {
		await withDb(async (sql) => {
			const { other, ada, bo, sam, as } = await team(sql)
			const groups = groupsFor(sql)
			const mine = await groups.create(as(ada), { name: "Design", memberIds: [bo] })
			const theirs = await groups.create(as(sam, other), { name: "Theirs", memberIds: [sam] })
			await sql`INSERT INTO exagram.group_members (group_id, user_id) VALUES (${theirs.id}, ${bo})`

			await membersFor(sql).remove(as(ada), bo, undefined)

			expect(await sql`SELECT group_id AS "groupId" FROM exagram.group_members WHERE user_id = ${bo}`).toEqual([
				{ groupId: theirs.id },
			])
			expect((await groups.list(as(ada))).items).toEqual([
				{ id: mine.id, name: "Design", memberCount: 0, memberIds: [] },
			])
		})
	})

	it("refuses a Group write that waits on its caller's own removal, without a deadlock", async () => {
		await withDb(async (sql) => {
			const { acme, ada, bo, cy, as } = await team(sql)
			await seedMembership(sql, { userId: bo, workspaceId: acme, isAdmin: true })
			const groups = groupsFor(sql)
			const { id } = await groups.create(as(bo), { name: "Design", memberIds: [bo, cy] })

			const { removed, written } = await raceRemoval(
				sql,
				bo,
				() => membersFor(sql).remove(as(ada), bo, undefined),
				() => groups.update(as(bo), id, { name: "Brand", memberIds: [cy] }),
			)

			expect(removed).toEqual({ id: bo })
			expect(written).toEqual({ error: RefusalError.name })
			expect((await groups.list(as(ada))).items).toEqual([{ id, name: "Design", memberCount: 1, memberIds: [cy] }])
		})
	})

	it("refuses a Group write that names a member whose removal it waited on", async () => {
		await withDb(async (sql) => {
			const { ada, bo, cy, as } = await team(sql)
			const groups = groupsFor(sql)

			const { removed, written } = await raceRemoval(
				sql,
				bo,
				() => membersFor(sql).remove(as(ada), bo, undefined),
				() => groups.create(as(ada), { name: "Design", memberIds: [bo, cy] }),
			)

			expect(removed).toEqual({ id: bo })
			expect(written).toEqual({ error: RefusalError.name })
			expect(await groupRows(sql)).toBe(0)
			expect(await sql`SELECT 1 FROM exagram.group_members`).toHaveLength(0)
		})
	})

	it("waits on a membership ending outside a Team change, so the person gets no place to revive on re-admission", async () => {
		await withDb(async (sql) => {
			const { acme, ada, bo, cy, as } = await team(sql)
			const groups = groupsFor(sql)
			const { id } = await groups.create(as(ada), { name: "Design", memberIds: [cy] })
			let commitRemoval = () => {}
			const removalHeld = new Promise<void>((resolve) => (commitRemoval = resolve))
			let removing = () => {}
			const removed = new Promise<void>((resolve) => (removing = resolve))
			const removal = sql.begin(async (tx) => {
				await tx`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${bo} AND workspace_id = ${acme}`
				removing()
				await removalHeld
			})
			await removed

			let settled = false
			const written = groups
				.update(as(ada), id, { name: "Design", memberIds: [bo, cy] })
				.then(
					() => "landed",
					(error: unknown) => (error as Error).constructor.name,
				)
				.finally(() => (settled = true))
			try {
				await untilLockWaits(sql, 1, () => settled)
			} finally {
				commitRemoval()
				await removal
			}

			expect(await written).toBe(RefusalError.name)
			await sql`UPDATE exagram.memberships SET removed_at = NULL WHERE user_id = ${bo} AND workspace_id = ${acme}`
			expect(await sql`SELECT 1 FROM exagram.group_members WHERE user_id = ${bo}`).toHaveLength(0)
			expect((await groups.list(as(ada))).items).toEqual([{ id, name: "Design", memberCount: 1, memberIds: [cy] }])
		})
	})

	it("lists 200 Groups of 20 members in one answer", async () => {
		await withDb(async (sql) => {
			const { acme, ada, as } = await team(sql)
			for (let n = 0; n < 20; n++) await seedUser(sql, { workspaceId: acme, email: `p${n}@acme.test`, name: `P${n}` })
			await sql`
				INSERT INTO exagram.groups (workspace_id, name, created_by)
				SELECT ${acme}, 'Group ' || lpad(n::text, 3, '0'), ${ada} FROM generate_series(1, 200) n`
			await sql`
				INSERT INTO exagram.group_members (group_id, user_id)
				SELECT g.id, u.id FROM exagram.groups g
				JOIN exagram.users u ON u.email LIKE 'p%@acme.test'`

			const listed = await groupsFor(sql).list(as(ada))

			expect(listed.items).toHaveLength(200)
			expect(listed.items.every((group) => group.memberCount === 20)).toBe(true)
			expect(listed.items.map((group) => group.name).slice(0, 2)).toEqual(["Group 001", "Group 002"])
		})
	})
})

describe("Groups in a Personal Workspace (integration)", () => {
	const withPersonal = async (sql: Sql) => {
		const fx = await team(sql)
		const personal = await seedPersonalWorkspace(sql, fx.ada, { isAdmin: true })
		return { ...fx, personal }
	}

	it("refuses a Personal owner every Groups call with the Personal sentence, and writes nothing", async () => {
		await withDb(async (sql) => {
			const { ada, personal, as } = await withPersonal(sql)
			const groups = groupsFor(sql)
			const inPersonal = as(ada, personal)

			const attempts = [
				() => groups.list(inPersonal),
				() => groups.create(inPersonal, { name: "Design", memberIds: [ada] }),
				() => groups.update(inPersonal, randomUUID(), { name: "Design", memberIds: [ada] }),
				() => groups.delete(inPersonal, randomUUID()),
			]
			for (const attempt of attempts) expect(await personalRule(attempt())).toBe(personalHas("Groups"))

			expect(await groupRows(sql)).toBe(0)
			expect(await groupCalls(sql)).toEqual([])
			expect((await groups.list(as(ada))).view).toBe("admin")
		})
	})

	it("answers the same person in their Team as before", async () => {
		await withDb(async (sql) => {
			const { ada, bo, as } = await withPersonal(sql)
			const groups = groupsFor(sql)

			const created = await groups.create(as(ada), { name: "Design", memberIds: [bo] })

			expect((await groups.list(as(ada))).items).toEqual([created])
		})
	})

	it("answers a caller who is no member of a Personal Workspace with the ordinary refusal, not its sentence", async () => {
		await withDb(async (sql) => {
			const { bo, personal, as } = await withPersonal(sql)
			const groups = groupsFor(sql)

			const answers = [
				await errorOf(groups.list(as(bo, personal))),
				await errorOf(groups.create(as(bo, personal), { name: "Design", memberIds: [bo] })),
				await errorOf(groups.delete(as(bo, personal), randomUUID())),
			]
			const missing = await errorOf(groups.list(as(bo, randomUUID())))
			for (const answer of answers) expect(answer).toEqual(missing)
			expect(missing).toEqual({ type: RefusalError.name, message: REFUSAL_TEXT })
		})
	})

	it("has the database refuse a Group in a Personal Workspace with the same sentence", async () => {
		await withDb(async (sql) => {
			const { ada, personal } = await withPersonal(sql)

			const insert = sql`INSERT INTO exagram.groups (workspace_id, name, created_by) VALUES (${personal}, 'Design', ${ada})`
			expect(await personalRule(insert)).toBe(personalHas("Groups"))
			expect(await groupRows(sql)).toBe(0)
		})
	})

	it("has the database refuse a Workspace with Groups becoming Personal, and let it once they are gone", async () => {
		await withDb(async (sql) => {
			const { acme, ada, bo, as } = await team(sql)
			const groups = groupsFor(sql)
			const { id } = await groups.create(as(ada), { name: "Design", memberIds: [bo] })
			await sql`DELETE FROM exagram.memberships WHERE workspace_id = ${acme} AND user_id <> ${ada}`
			await dropPersonalWorkspace(sql, ada)
			const flip = () => sql`
				UPDATE exagram.workspaces SET kind = 'personal', redaction = 'off', default_share_role = 'view',
					join_approval = 'admin', member_invites = false, link_preview = 'generic'
				WHERE id = ${acme}`

			expect(await personalRule(flip())).toBe(personalHas("Groups"))
			expect((await sql`SELECT kind FROM exagram.workspaces WHERE id = ${acme}`)[0]!.kind).toBe("team")

			await groups.delete(as(ada), id)
			await flip()
			expect((await sql`SELECT kind FROM exagram.workspaces WHERE id = ${acme}`)[0]!.kind).toBe("personal")
		})
	})

	it("makes a Workspace becoming Personal wait for a Group being inserted, then refuse it", async () => {
		await withDb(async (sql) => {
			const { acme, ada } = await team(sql)
			await sql`DELETE FROM exagram.memberships WHERE workspace_id = ${acme} AND user_id <> ${ada}`
			await dropPersonalWorkspace(sql, ada)
			let release = () => {}
			const gate = new Promise<void>((resolve) => (release = resolve))
			let inserted = () => {}
			const insertedOnce = new Promise<void>((resolve) => (inserted = resolve))
			const inserting = sql.begin(async (tx) => {
				await tx`INSERT INTO exagram.groups (workspace_id, name, created_by) VALUES (${acme}, 'Design', ${ada})`
				inserted()
				await gate
			})
			await insertedOnce

			const flipping = personalRule(sql`
				UPDATE exagram.workspaces SET kind = 'personal', redaction = 'off', default_share_role = 'view',
					join_approval = 'admin', member_invites = false, link_preview = 'generic'
				WHERE id = ${acme}`)
			await untilLockWaits(sql, 1)
			release()
			await inserting

			expect(await flipping).toBe(personalHas("Groups"))
			expect((await sql`SELECT kind FROM exagram.workspaces WHERE id = ${acme}`)[0]!.kind).toBe("team")
		})
	})
})
