import { describe, expect, it } from "vitest"

import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "../../entity/auth"
import { with000046RolledBack, with000047RolledBack } from "../../test/migration-halves"
import { OLD_IMAGE } from "../../test/old-image-queries"
import { truncateAll, withDb } from "../../test/pg"
import { seedUser, seedWorkspace } from "../../test/seed"

import { AuthRepository } from "./auth.repository"
import { GrantsRepository } from "./grants.repository"
import { MembersRepository } from "./members.repository"

import type { Sql } from "postgres"

type Params = NonNullable<Parameters<Sql["unsafe"]>[1]>

type Row = {
	id: string
	workspace_id: string | null
	is_admin: boolean
	removed_at: Date | null
	invited_at: Date | null
	has_live_membership: boolean
	live_team_id: string | null
	memberships: number
}

const run = (sql: Pick<Sql, "unsafe">, name: keyof typeof OLD_IMAGE, params: Params) =>
	sql.unsafe<Row[]>(OLD_IMAGE[name], params)

const kindOf = async (sql: Sql, workspaceId: string | null) =>
	workspaceId === null
		? null
		: ((await sql<{ kind: string }[]>`SELECT kind FROM exagram.workspaces WHERE id = ${workspaceId}`)[0]?.kind ??
			"gone")

type Step = Record<string, unknown>

// users.joined_at and last_seen_at are written by the old image and read by none of its statements, and
// memberships_legacy_mirror sets them from the home membership, so they stay out of the comparison.
const snapshot = async (sql: Sql, step: string, email: string): Promise<Step> => {
	const [user] = await sql<Pick<Row, "workspace_id" | "is_admin" | "removed_at" | "invited_at">[]>`
		SELECT workspace_id, is_admin, removed_at, invited_at FROM exagram.users WHERE email = ${email}`
	if (!user) return { step, gone: true }
	const [read] = await run(sql, "getUserByEmail", [email])
	return {
		step,
		home: await kindOf(sql, user.workspace_id),
		isAdmin: user.is_admin,
		removed: user.removed_at !== null,
		invited: user.invited_at !== null,
		read: {
			isAdmin: read!.is_admin,
			invited: read!.invited_at !== null,
			hasLiveMembership: read!.has_live_membership,
			liveTeam: await kindOf(sql, read!.live_team_id),
		},
	}
}

const runOldImage = async (sql: Sql) => {
	const team = await seedWorkspace(sql, "Team")
	const steps: Step[] = []
	const record = async (step: string, email: string) => {
		steps.push(await snapshot(sql, step, email))
	}

	await run(sql, "insertUser", [team, "boss@x.test", "Boss", "hash", true])
	const [ada] = await run(sql, "insertUser", [team, "ada@x.test", "Ada", "hash", false])
	await record("sign-up", "ada@x.test")

	await run(sql, "insertSession", ["t".repeat(64), new Date(Date.now() + 3_600_000), ada!.id])
	const [session] = await run(sql, "getUserBySessionTokenHash", ["t".repeat(64)])
	steps.push({
		step: "session",
		home: await kindOf(sql, session!.workspace_id),
		isAdmin: session!.is_admin,
	})

	await run(sql, "touchUserLastSeen", [ada!.id, team])
	await record("touched", "ada@x.test")
	await run(sql, "promoteUserToAdmin", [ada!.id, team])
	await record("promoted", "ada@x.test")
	await run(sql, "setMemberAdmin", [false, ada!.id, team])
	await record("demoted", "ada@x.test")
	await run(sql, "markMemberRemoved", [ada!.id, team])
	await record("removed", "ada@x.test")
	await run(sql, "joinWorkspace", [team, "member", ada!.id])
	await record("rejoined", "ada@x.test")

	const [invited] = await run(sql, "insertInvitedMember", [
		team,
		"inv@x.test",
		"inv@x.test",
		GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
	])
	await record("invited", "inv@x.test")
	await run(sql, "claimUnclaimedAccount", [invited!.id, "Inv", "hash"])
	await record("claimed", "inv@x.test")

	const [orphan] = await run(sql, "insertInvitedMember", [
		team,
		"orphan@x.test",
		"orphan@x.test",
		GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
	])
	await sql`UPDATE exagram.users SET invited_at = now() - interval '40 days' WHERE id = ${orphan!.id}`
	const cutoff = new Date(Date.now() - 30 * 86_400_000)
	const swept = await sql.begin(async (tx) => {
		const locked = await run(tx, "lockOrphanInvitedMembers", [cutoff])
		return run(tx, "deleteLockedOrphanInvitedMembers", [
			`{${locked.map((row) => row.id).join(",")}}`,
			`{${locked.map((row) => row.memberships).join(",")}}`,
			cutoff,
		])
	})
	expect(swept).toHaveLength(1)
	await record("swept", "orphan@x.test")

	return steps
}

describe("the image before 000046, running its own statements between 000046 and 000047", () => {
	it("prepares every statement 000046 changed", async () => {
		await withDb((sql) =>
			with000047RolledBack(sql, async () => {
				for (const [name, text] of Object.entries(OLD_IMAGE)) {
					await expect(sql.unsafe(text).describe(), name).resolves.toBeDefined()
				}
			}),
		)
	})

	it("writes rows this image reads right", async () => {
		await withDb((sql) =>
			with000047RolledBack(sql, async () => {
				const team = await seedWorkspace(sql, "Team")
				await run(sql, "insertUser", [team, "boss@x.test", "Boss", "hash", true])
				const [ada] = await run(sql, "insertUser", [team, "ada@x.test", "Ada", "hash", false])
				const [invited] = await run(sql, "insertInvitedMember", [
					team,
					"inv@x.test",
					"inv@x.test",
					GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL,
				])
				const auth = new AuthRepository(sql)
				const members = new MembersRepository(sql)
				expect(await auth.getUserByEmail("inv@x.test")).toMatchObject({
					unclaimed: true,
					earliestInvitingWorkspaceId: team,
					hasLiveMembership: false,
				})

				await run(sql, "claimUnclaimedAccount", [invited!.id, "Inv", "hash"])
				expect(await auth.getUserByEmail("inv@x.test")).toMatchObject({ unclaimed: false, hasLiveMembership: true })

				await run(sql, "promoteUserToAdmin", [ada!.id, team])
				expect((await members.list(team)).find((member) => member.id === ada!.id)).toMatchObject({ role: "admin" })

				await run(sql, "markMemberRemoved", [ada!.id, team])
				const [personal] = await sql<{ id: string }[]>`
				SELECT workspace_id AS id FROM exagram.memberships WHERE user_id = ${ada!.id} AND kind = 'personal'`
				expect(await auth.getUserById(ada!.id)).toMatchObject({ workspaceId: personal!.id })
				expect((await members.list(team)).some((member) => member.id === ada!.id)).toBe(false)
			}),
		)
	})

	it("reads and claims a bare account this image made, which has no Workspace", async () => {
		await withDb((sql) =>
			with000047RolledBack(sql, async () => {
				const team = await seedWorkspace(sql, "Team")
				const owner = await seedUser(sql, { workspaceId: team, email: "owner@x.test" })
				const [personal] = await sql<{ id: string }[]>`
				SELECT workspace_id AS id FROM exagram.memberships WHERE user_id = ${owner} AND kind = 'personal'`
				const bare = (await new GrantsRepository(sql).insertInvitedMember(personal!.id, "bare@x.test"))!

				const [read] = await run(sql, "getUserByEmail", ["bare@x.test"])
				expect(read).toMatchObject({ id: bare, workspace_id: null, has_live_membership: false })
				expect(read!.invited_at).toBeInstanceOf(Date)

				await run(sql, "claimUnclaimedAccount", [bare, "Bare", "hash"])
				const [claimed] = await run(sql, "getUserByEmail", ["bare@x.test"])
				expect(claimed).toMatchObject({ has_live_membership: true, invited_at: null })
			}),
		)
	})

	it("leaves the users columns it reads exactly as it leaves them without 000046", async () => {
		await withDb(async (sql) => {
			const withoutIt = await with000046RolledBack(sql, async () => {
				const steps = await runOldImage(sql)
				await truncateAll(sql)
				return steps
			})
			expect(await with000047RolledBack(sql, () => runOldImage(sql))).toEqual(withoutIt)
		})
	})
})
