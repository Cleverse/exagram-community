import { randomUUID } from "node:crypto"

import { GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL } from "@exagram/core/entity/auth"
import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import {
	deleteLockedOrphanInvitedMembers,
	lockOrphanInvitedMembers,
} from "@exagram/core/repository/postgres/gen/exagram_grants_sql"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { MembersRepository } from "@exagram/core/repository/postgres/members.repository"
import { NotificationsRepository } from "@exagram/core/repository/postgres/notifications.repository"
import { PasswordResetsRepository } from "@exagram/core/repository/postgres/password-resets.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { runHalf, with000046RolledBack } from "@exagram/core/test/migration-halves"
import { withDb } from "@exagram/core/test/pg"
import { seedGrant, seedLink, seedWorkspace } from "@exagram/core/test/seed"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { AlreadyInTeamError } from "@exagram/core/utils/errors"
import { RefusalError } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import type { Me } from "@exagram/core/entity/auth"

import { startSessionApi, type SessionApi } from "../../../test/sessionApi"
import { GrantsUsecase } from "../grants.usecase"

import { AuthUsecase, type SignedIn } from "./auth.usecase"
import {
	dormantRows,
	googleProfile,
	grantsFor,
	inApi,
	invite,
	inviteExists,
	me,
	PASSWORD,
	proveEmail,
	published,
	resultOf,
	sessionTokenOf,
	shareFromPersonal,
	sharedWithUnproven,
	signUp,
	switchTo,
	teamOwner,
	titles,
} from "./personal-signup.fixtures"

import type { Sql } from "postgres"

describe("sign-up makes a Personal Workspace", () => {
	it("asks for no Workspace name, ignores an old one, and lands the person in Personal", () =>
		inApi(async (sql, api) => {
			const response = await api.call({
				method: "POST",
				path: "/v1/auth/sign-up",
				body: { email: "ada@acme.test", name: "Ada", password: PASSWORD, workspaceName: "Old Mac Co" },
			})
			const ada = await me(api, sessionTokenOf(response))
			expect(ada).toMatchObject({ workspaceName: "Personal", workspaceKind: "personal", isAdmin: true })
			expect(ada.workspaces).toEqual([{ id: ada.workspaceId, kind: "personal", name: "Personal", role: "admin" }])
			expect(await sql`SELECT name, kind, owner_id FROM exagram.workspaces`).toEqual([
				{ name: "Personal", kind: "personal", owner_id: ada.id },
			])
		}))

	it("makes a new Google account's Personal Workspace, whether or not it chose create", () =>
		inApi(async (_sql, api) => {
			for (const [email, choice] of [
				["one@acme.test", undefined],
				["two@acme.test", "create"],
			] as const) {
				const signedIn = await api.auth.signInWithGoogle({
					profile: googleProfile(email),
					...(choice ? { choice } : {}),
				})
				expect(await me(api, signedIn.token)).toMatchObject({ workspaceKind: "personal", workspaceName: "Personal" })
			}
		}))
})

describe("Create team", () => {
	it("makes the caller its Workspace Owner and an Admin, lets them switch in, and refuses a second", () =>
		inApi(async (sql, api) => {
			const ada = await signUp(api, "ada@acme.test")
			const created = await api.call({
				method: "POST",
				path: "/v1/workspace/teams",
				token: ada.token,
				body: { name: " Acme " },
			})
			const team = resultOf<{ id: string; kind: string; name: string; role: string }>(created)
			expect(team).toEqual({ id: team.id, kind: "team", name: "Acme", role: "admin" })
			expect(await sql`SELECT owner_id FROM exagram.workspaces WHERE id = ${team.id}`).toEqual([
				{ owner_id: ada.user.id },
			])

			const before = await me(api, ada.token)
			expect(before.workspaceKind).toBe("personal")
			expect(before.workspaces.map((workspace) => [workspace.kind, workspace.role])).toEqual([
				["personal", "admin"],
				["team", "admin"],
			])
			const switched = resultOf<Me>(await switchTo(api, ada.token, team.id))
			expect(switched).toMatchObject({
				workspaceId: team.id,
				workspaceKind: "team",
				workspaceName: "Acme",
				isAdmin: true,
			})

			const second = await api.call({
				method: "POST",
				path: "/v1/workspace/teams",
				token: ada.token,
				body: { name: "Beta" },
			})
			expect(second.status).toBe(409)
			expect(second.json).toMatchObject({ code: "ALREADY_IN_TEAM" })
			expect(await sql`SELECT count(*)::int AS n FROM exagram.workspaces WHERE kind = 'team'`).toEqual([{ n: 1 }])
		}))
})

describe("one live Team per person", () => {
	it("refuses an Invite into a second Team, by password and by Google, and leaves the Invite usable", () =>
		inApi(async (sql, api) => {
			const a = await teamOwner(api, "owner-a@a.test", "Team A")
			const b = await teamOwner(api, "owner-b@b.test", "Team B")
			const token = await invite(sql, b.teamId, b.user.id, "owner-a@a.test")

			await expect(
				api.auth.signUp({ email: "owner-a@a.test", name: "A", password: PASSWORD, inviteToken: token }),
			).rejects.toBeInstanceOf(AlreadyInTeamError)
			await new AuthRepository(sql).createUserIdentity({
				userId: a.user.id,
				provider: "google",
				subject: "sub-a",
				email: "owner-a@a.test",
			})
			await expect(
				api.auth.signInWithGoogle({ profile: googleProfile("owner-a@a.test", "sub-a"), inviteToken: token }),
			).rejects.toBeInstanceOf(AlreadyInTeamError)
			expect(await inviteExists(sql, token)).toBe(true)
			expect((await me(api, a.token)).workspaces.map((workspace) => workspace.kind)).toEqual(["personal", "team"])
		}))

	it("lets a Personal-only account accept an Invite with its own password, and refuses a wrong one", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const solo = await signUp(api, "solo@else.test")
			const token = await invite(sql, owner.teamId, owner.user.id, "solo@else.test")

			await expect(
				api.auth.signUp({ email: "solo@else.test", name: "S", password: "a wrong password!", inviteToken: token }),
			).rejects.toThrow("That email is already registered.")
			const joined = await api.auth.signUp({
				email: "solo@else.test",
				name: "Solo",
				password: PASSWORD,
				inviteToken: token,
			})
			expect(joined.user).toMatchObject({ id: solo.user.id, workspaceId: owner.teamId, isAdmin: false })
			expect((await me(api, joined.token)).workspaces.map((workspace) => workspace.kind)).toEqual(["personal", "team"])
		}))

	it("adopts the Google identity for a password-only account that signs in with Google through its Invite", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const solo = await signUp(api, "solo@else.test")
			const token = await invite(sql, owner.teamId, owner.user.id, "solo@else.test")

			const signedIn = await api.auth.signInWithGoogle({
				profile: googleProfile("solo@else.test", "sub-solo"),
				inviteToken: token,
			})
			expect(signedIn.user).toMatchObject({ id: solo.user.id, workspaceId: owner.teamId, googleLinked: true })
			expect(await sql`SELECT user_id, subject FROM exagram.user_identities`).toEqual([
				{ user_id: solo.user.id, subject: "sub-solo" },
			])
			const again = await api.auth.signInWithGoogle({ profile: googleProfile("solo@else.test", "sub-solo") })
			expect(again.user.id).toBe(solo.user.id)
		}))
})

describe("what is shared with a person lands in their Personal Workspace", () => {
	it("lists a share from someone's Personal Workspace and a Guest Grant in Personal, and neither in the Team", () =>
		inApi(async (sql, api) => {
			const p = await teamOwner(api, "p@acme.test", "Acme")
			const friend = await signUp(api, "friend@else.test")
			const outsider = await teamOwner(api, "x@other.test", "Other")
			await proveEmail(sql, p.user.id)

			const fromPersonal = await published(sql, {
				workspaceId: friend.user.workspaceId,
				ownerId: friend.user.id,
				title: "From a friend",
			})
			await grantsFor(sql).create(friend.user.id, {
				artifactId: fromPersonal,
				granteeEmail: "p@acme.test",
				role: "view",
			})
			const fromTeam = await published(sql, {
				workspaceId: outsider.teamId,
				ownerId: outsider.user.id,
				title: "From X",
			})
			await seedGrant(sql, { artifactId: fromTeam, granteeId: p.user.id, createdBy: outsider.user.id, role: "view" })
			await published(sql, { workspaceId: p.teamId, ownerId: p.user.id, title: "Team file" })

			expect(await titles(api, p.token, "sharedWithMe")).toEqual([])
			expect(await titles(api, p.token, "all")).toEqual(["Team file"])
			resultOf(await switchTo(api, p.token, p.personalId))
			expect(await titles(api, p.token, "sharedWithMe")).toEqual(["From X", "From a friend"])
		}))

	it("lets a person shared with only from Personal Workspaces claim that row with Google, keeping the share", () =>
		inApi(async (sql, api) => {
			const friend = await signUp(api, "friend@else.test")
			const file = await published(sql, {
				workspaceId: friend.user.workspaceId,
				ownerId: friend.user.id,
				title: "For a newcomer",
			})
			await grantsFor(sql).create(friend.user.id, { artifactId: file, granteeEmail: "new@else.test", role: "view" })
			const [bare] = await sql<{ id: string }[]>`SELECT id FROM exagram.users WHERE email = 'new@else.test'`

			const signedIn = await api.auth.signInWithGoogle({ profile: googleProfile("new@else.test") })
			expect(signedIn.user.id).toBe(bare!.id)
			const newcomer = await me(api, signedIn.token)
			expect(newcomer).toMatchObject({ workspaceKind: "personal", name: "Google new@else.test" })
			expect(newcomer.workspaces).toHaveLength(1)
			expect(await titles(api, signedIn.token, "sharedWithMe")).toEqual(["For a newcomer"])
		}))

	it("suggests nobody for a Personal file, whoever shares the person's Team", () =>
		inApi(async (sql, api) => {
			const p = await teamOwner(api, "p@acme.test", "Acme")
			await api.auth.signUp({ email: "mate@acme.test", name: "Mate", password: PASSWORD })
			const mate = await api.auth.signIn({ email: "mate@acme.test", password: PASSWORD })
			await new AuthRepository(sql).joinWorkspace({ userId: mate.user.id, workspaceId: p.teamId, role: "member" })
			const personalFile = await published(sql, { workspaceId: p.personalId, ownerId: p.user.id, title: "Mine" })
			const teamFile = await published(sql, { workspaceId: p.teamId, ownerId: p.user.id, title: "Ours" })

			const grants = grantsFor(sql)
			expect(await grants.suggestions(p.user.id, { artifactId: personalFile })).toEqual([])
			expect((await grants.suggestions(p.user.id, { artifactId: teamFile })).map((row) => row.email)).toEqual([
				"mate@acme.test",
			])
		}))
})

describe("leaving a Team keeps the Personal Workspace", () => {
	it("lands a removed person's next session in Personal, with their Personal files", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const member = await signUp(api, "m@acme.test")
			await new AuthRepository(sql).joinWorkspace({ userId: member.user.id, workspaceId: owner.teamId, role: "member" })
			await published(sql, { workspaceId: member.user.workspaceId, ownerId: member.user.id, title: "Still mine" })

			await new MembersRepository(sql).remove({ userId: member.user.id, workspaceId: owner.teamId })
			const again = await api.auth.signIn({ email: "m@acme.test", password: PASSWORD })
			expect(await me(api, again.token)).toMatchObject({
				workspaceId: member.user.workspaceId,
				workspaceKind: "personal",
				workspaces: [{ id: member.user.workspaceId, kind: "personal", name: "Personal", role: "admin" }],
			})
			expect(await titles(api, again.token, "all")).toEqual(["Still mine"])
		}))
})

describe("a Reset Link is checked against the Workspace it was made in", () => {
	const authWithResets = (sql: Sql) =>
		new AuthUsecase(
			new AuthRepository(sql),
			new PasswordService(),
			new SessionTokenService(),
			new TransactionProvider(sql),
			{ joining: {} as never, requests: {} as never },
			3600,
			{ ledger: new LedgerService(new LedgerRepository(sql)), adminPasswordReset: true },
		)

	const link = async (sql: Sql, userId: string, createdBy: string, workspaceId: string) => {
		const { token, tokenHash } = mintLinkToken()
		await new PasswordResetsRepository(sql).upsert({
			userId,
			tokenHash,
			createdBy,
			workspaceId,
			expiresAt: new Date(Date.now() + 3_600_000),
		})
		return token
	}

	it("works while its maker is an Admin of that Team, and not once the maker has left it", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const member = await signUp(api, "m@acme.test")
			await new AuthRepository(sql).joinWorkspace({ userId: member.user.id, workspaceId: owner.teamId, role: "member" })
			const auth = authWithResets(sql)

			const honoured = await link(sql, member.user.id, owner.user.id, owner.teamId)
			await expect(auth.resetPassword({ token: honoured, password: "a brand new password" })).resolves.toMatchObject({
				user: { id: member.user.id },
			})

			const stale = await link(sql, member.user.id, owner.user.id, owner.teamId)
			await sql`UPDATE exagram.memberships SET removed_at = now() WHERE user_id = ${owner.user.id} AND kind = 'team'`
			await expect(auth.resetPassword({ token: stale, password: "another new password" })).rejects.toThrow(
				"This reset link is no longer valid.",
			)
		}))

	it("refuses a link, at creation and at use, once its holder has proven their email", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const member = await signUp(api, "m@acme.test")
			await new AuthRepository(sql).joinWorkspace({ userId: member.user.id, workspaceId: owner.teamId, role: "member" })
			const resets = new PasswordResetsRepository(sql)
			const made = await link(sql, member.user.id, owner.user.id, owner.teamId)
			expect(await resets.adminResetRefused(member.user.id, owner.teamId)).toBe(false)

			await api.auth.linkGoogleIdentity({ userId: member.user.id, profile: googleProfile("m@acme.test") })

			expect(await resets.adminResetRefused(member.user.id, owner.teamId)).toBe(true)
			await expect(
				authWithResets(sql).resetPassword({ token: made, password: "a brand new password" }),
			).rejects.toThrow("This reset link is no longer valid.")
		}))
})

describe("nothing unproven takes over or destroys a share", () => {
	const dormant = async (sql: Sql) =>
		(await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM exagram.grants WHERE dormant`)[0]!.n
	const personalOf = async (api: SessionApi, token: string) =>
		(await me(api, token)).workspaces.find((workspace) => workspace.kind === "personal")!.id

	it("keeps a Personal share asleep when another Team's Join Link and a password claim the address", () =>
		inApi(async (sql, api) => {
			await shareFromPersonal(sql, api, "victim@else.test")
			const admin = await teamOwner(api, "admin@squat.test", "Squatters")
			const token = await invite(sql, admin.teamId, admin.user.id, "victim@else.test")

			const squatter = await api.auth.signUp({
				email: "victim@else.test",
				name: "Not the victim",
				password: PASSWORD,
				inviteToken: token,
			})
			expect(squatter.user.workspaceId).toBe(admin.teamId)
			resultOf(await switchTo(api, squatter.token, await personalOf(api, squatter.token)))
			expect(await titles(api, squatter.token, "all")).toEqual([])
			expect(await dormant(sql)).toBe(1)

			const owner = await api.auth.signInWithGoogle({ profile: googleProfile("victim@else.test") })
			expect(owner.user.id).toBe(squatter.user.id)
			await expect(api.auth.signIn({ email: "victim@else.test", password: PASSWORD })).rejects.toThrow(
				"Email or password is incorrect.",
			)
			expect(await api.auth.resolveSession(squatter.token)).toBeNull()
			expect(await dormant(sql)).toBe(0)
			resultOf(await switchTo(api, owner.token, await personalOf(api, owner.token)))
			expect(await titles(api, owner.token, "sharedWithMe")).toEqual(["For the address"])
		}))

	it("answers a password sign-up for a shared-with address as any sign-up, and keeps the share asleep", () =>
		inApi(async (sql, api) => {
			await shareFromPersonal(sql, api, "new@else.test")
			await sql`UPDATE exagram.users SET created_at = now() - interval '30 days' WHERE email = 'new@else.test'`
			const [clock] = await sql<{ before: Date }[]>`SELECT clock_timestamp() AS before`
			const response = await api.call({
				method: "POST",
				path: "/v1/auth/sign-up",
				body: { email: "new@else.test", name: "New", password: PASSWORD },
			})
			const fresh = await api.call({
				method: "POST",
				path: "/v1/auth/sign-up",
				body: { email: "fresh@else.test", name: "Fresh", password: PASSWORD },
			})
			expect([response.status, fresh.status]).toEqual([200, 200])
			expect(Object.keys(response.json.result as object).sort()).toEqual(
				Object.keys(fresh.json.result as object).sort(),
			)
			const { createdAt } = response.json.result as { createdAt: string }
			expect(new Date(createdAt).getTime()).toBeGreaterThanOrEqual(clock!.before.getTime())
			expect(await titles(api, sessionTokenOf(response), "all")).toEqual([])
			expect(await dormant(sql)).toBe(1)
		}))

	it("puts a share made before 000044 to sleep when a password claims its address, until Google proves it", () =>
		inApi(async (sql, api) => {
			const file = await shareFromPersonal(sql, api, "early@else.test")
			await sql`UPDATE exagram.grants SET dormant = false`

			const squatter = await api.call({
				method: "POST",
				path: "/v1/auth/sign-up",
				body: { email: "early@else.test", name: "Not them", password: PASSWORD },
			})
			expect(squatter.status).toBe(200)
			expect(await titles(api, sessionTokenOf(squatter), "sharedWithMe")).toEqual([])
			const read = await api.call({ method: "GET", path: `/v1/artifacts/${file}`, token: sessionTokenOf(squatter) })
			const missing = await api.call({
				method: "GET",
				path: `/v1/artifacts/${randomUUID()}`,
				token: sessionTokenOf(squatter),
			})
			expect([read.status, read.body]).toEqual([missing.status, missing.body])
			expect(await dormant(sql)).toBe(1)

			const owner = await api.auth.signInWithGoogle({ profile: googleProfile("early@else.test") })
			expect(await titles(api, owner.token, "sharedWithMe")).toEqual(["For the address"])
			const after = await api.call({ method: "GET", path: "/v1/artifacts", token: sessionTokenOf(squatter) })
			expect(after.status).toBe(401)
		}))

	it("takes a pre-registered address back from whoever set its password when its owner signs in with Google", () =>
		inApi(async (sql, api) => {
			const squatter = await signUp(api, "owner@mail.test")
			await new PasswordResetsRepository(sql).upsert({
				userId: squatter.user.id,
				tokenHash: "pending-reset",
				createdBy: null,
				workspaceId: null,
				expiresAt: new Date(Date.now() + 3_600_000),
			})
			await sql`INSERT INTO exagram.connections (user_id, oidc_client_id, name, scopes, oidc_grant_id, workspace_id)
				VALUES (${squatter.user.id}, 'squatter-tool', 'Tool', ARRAY['read'], 'grant-1',
					exagram.home_workspace(${squatter.user.id}))`
			await sql`INSERT INTO exagram.oidc_payloads (id, type, grant_id) VALUES ('grant-1', 'Grant', NULL),
				('token-1', 'AccessToken', 'grant-1')`
			const file = await published(sql, {
				workspaceId: squatter.user.workspaceId,
				ownerId: squatter.user.id,
				title: "Squatted",
			})
			const [current] = await sql<
				{ id: string }[]
			>`SELECT current_revision_id AS id FROM exagram.artifacts WHERE id = ${file}`
			await seedLink(sql, { artifactId: file, revisionId: current!.id, createdBy: squatter.user.id })
			const team = await teamOwner(api, "admin@acme.test", "Acme")
			await sql`INSERT INTO exagram.join_requests (workspace_id, email, name, password_hash, via)
				VALUES (${team.teamId}, 'owner@mail.test', 'Squatter', 'hash', 'domain')`
			const owner = await api.auth.signInWithGoogle({ profile: googleProfile("owner@mail.test") })
			expect(owner.user.id).toBe(squatter.user.id)
			expect(await api.auth.resolveSession(squatter.token)).toBeNull()
			expect(await sql`SELECT revoked_at IS NOT NULL AS revoked FROM exagram.connections`).toEqual([{ revoked: true }])
			await expect(api.auth.signIn({ email: "owner@mail.test", password: PASSWORD })).rejects.toThrow(
				"Email or password is incorrect.",
			)
			expect(await sql`SELECT 1 FROM exagram.password_resets`).toEqual([])
			expect(await sql`SELECT 1 FROM exagram.oidc_payloads`).toEqual([])
			expect(await sql`SELECT revoked_at IS NOT NULL AS revoked FROM exagram.links`).toEqual([{ revoked: true }])
			expect(await sql`SELECT 1 FROM exagram.join_requests`).toEqual([])
			expect(await sql`SELECT title FROM exagram.artifacts WHERE id = ${file}`).toEqual([{ title: "Squatted" }])
		}))

	it("makes a Team's share by email a Guest's, never a membership, when its person signs in with no Invite", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const file = await published(sql, { workspaceId: owner.teamId, ownerId: owner.user.id, title: "Team doc" })
			await grantsFor(sql).create(owner.user.id, { artifactId: file, granteeEmail: "guest@else.test", role: "view" })

			const guest = await api.auth.signInWithGoogle({ profile: googleProfile("guest@else.test") })
			expect((await me(api, guest.token)).workspaces.map((workspace) => workspace.kind)).toEqual(["personal"])
			expect(await sql`SELECT kind FROM exagram.memberships WHERE user_id = ${guest.user.id}`).toEqual([
				{ kind: "personal" },
			])
			expect(await titles(api, guest.token, "sharedWithMe")).toEqual(["Team doc"])
		}))

	it("refuses an Admin's Reset Link for a member who uses their Personal Workspace", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const member = await signUp(api, "m@acme.test")
			await new AuthRepository(sql).joinWorkspace({ userId: member.user.id, workspaceId: owner.teamId, role: "member" })
			await published(sql, { workspaceId: member.user.workspaceId, ownerId: member.user.id, title: "Private" })
			const { token, tokenHash } = mintLinkToken()
			await new PasswordResetsRepository(sql).upsert({
				userId: member.user.id,
				tokenHash,
				createdBy: owner.user.id,
				workspaceId: owner.teamId,
				expiresAt: new Date(Date.now() + 3_600_000),
			})
			const auth = new AuthUsecase(
				new AuthRepository(sql),
				new PasswordService(),
				new SessionTokenService(),
				new TransactionProvider(sql),
				{ joining: {} as never, requests: {} as never },
				3600,
				{ ledger: new LedgerService(new LedgerRepository(sql)), adminPasswordReset: true },
			)
			await expect(auth.resetPassword({ token, password: "a brand new password" })).rejects.toThrow(
				"This reset link is no longer valid.",
			)
		}))
})

describe("a share by email to an unproven account is dormant until the email is proven", () => {
	it("reaches no list, read, search, folder list or notification, and refuses the read as not-found", () =>
		inApi(async (sql, api) => {
			const { person, file } = await sharedWithUnproven(sql, api)
			expect((await dormantRows(sql, person.user.id)).map((row) => row.dormant)).toEqual([true, true])

			expect(await titles(api, person.token, "all")).toEqual([])
			expect(await titles(api, person.token, "sharedWithMe")).toEqual([])
			const read = await api.call({ method: "GET", path: `/v1/artifacts/${file}`, token: person.token })
			const missing = await api.call({ method: "GET", path: `/v1/artifacts/${randomUUID()}`, token: person.token })
			expect([read.status, read.body]).toEqual([missing.status, missing.body])
			const found = await api.call({ method: "GET", path: "/v1/artifacts/search?q=Dormant", token: person.token })
			expect(resultOf<{ items: unknown[] }>(found).items).toEqual([])
			const folders = await api.call({ method: "GET", path: "/v1/projects", token: person.token })
			expect(resultOf<{ items: unknown[] }>(folders).items).toEqual([])
			const feed = await new NotificationsRepository(sql).listSince(
				person.user.id,
				{ notBefore: new Date(0), after: null, workspaceId: person.user.workspaceId },
				50,
			)
			expect(feed).toEqual([])
		}))

	it("shows the sharer each dormant Grant as pending, by email, and lets them change its role or revoke it", () =>
		inApi(async (sql, api) => {
			const { person, friend, file, fileGrant, folderGrant, grants } = await sharedWithUnproven(sql, api)
			await sql`UPDATE exagram.users SET name = 'Somebody Real' WHERE id = ${person.user.id}`

			expect(await grants.list(friend.user.id, { artifactId: file })).toMatchObject([
				{ id: fileGrant.id, grantee: { pending: true, name: "person@else.test", email: "person@else.test" } },
			])
			await grants.updateRole(friend.user.id, fileGrant.id, "edit")
			await grants.remove(friend.user.id, folderGrant.id)
			expect(await dormantRows(sql, person.user.id)).toEqual([{ id: fileGrant.id, dormant: true }])

			const again = await grants.create(friend.user.id, {
				projectId: folderGrant.projectId!,
				granteeEmail: "person@else.test",
				role: "view",
			})
			expect((await dormantRows(sql, person.user.id)).find((row) => row.id === again.id)?.dormant).toBe(true)
			await proveEmail(sql, person.user.id)
			await api.auth.signIn({ email: "person@else.test", password: PASSWORD })
			expect((await dormantRows(sql, person.user.id)).map((row) => row.dormant)).toEqual([false, false])
			expect(await sql`SELECT 1 FROM exagram.grants WHERE id = ${folderGrant.id}`).toEqual([])
		}))

	it("counts no dormant pinned Grant against handing out its folder", () =>
		inApi(async (sql, api) => {
			const { person, file, folder } = await sharedWithUnproven(sql, api)
			await sql`UPDATE exagram.artifacts SET project_id = ${folder} WHERE id = ${file}`
			await sql`UPDATE exagram.grants g SET pinned_revision_id = a.current_revision_id
				FROM exagram.artifacts a WHERE a.id = g.artifact_id AND g.grantee_id = ${person.user.id}`
			const grants = new GrantsRepository(sql)

			expect(await grants.hasPinnedGrantUnderProject(folder, person.user.id)).toBe(false)
			await sql`UPDATE exagram.grants SET dormant = false WHERE grantee_id = ${person.user.id}`
			expect(await grants.hasPinnedGrantUnderProject(folder, person.user.id)).toBe(true)
		}))

	it("lets a Team's share to its own live member reach them at once, proven or not", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const member = await signUp(api, "m@acme.test")
			await new AuthRepository(sql).joinWorkspace({ userId: member.user.id, workspaceId: owner.teamId, role: "member" })
			const file = await published(sql, { workspaceId: owner.teamId, ownerId: owner.user.id, title: "Team memo" })
			await grantsFor(sql).create(owner.user.id, { artifactId: file, granteeEmail: "m@acme.test", role: "view" })

			expect((await dormantRows(sql, member.user.id)).map((row) => row.dormant)).toEqual([false])
		}))

	it("wakes a Team's dormant share once its own Invite admits the person, and only that Team's", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const friend = await signUp(api, "friend@else.test")
			const teamFile = await published(sql, { workspaceId: owner.teamId, ownerId: owner.user.id, title: "Team memo" })
			const friendFile = await published(sql, {
				workspaceId: friend.user.workspaceId,
				ownerId: friend.user.id,
				title: "Friend memo",
			})
			await grantsFor(sql).create(owner.user.id, { artifactId: teamFile, granteeEmail: "new@else.test", role: "view" })
			await grantsFor(sql).create(friend.user.id, {
				artifactId: friendFile,
				granteeEmail: "new@else.test",
				role: "view",
			})
			const token = await invite(sql, owner.teamId, owner.user.id, "new@else.test")

			const joined = await api.auth.signUp({
				email: "new@else.test",
				name: "New",
				password: PASSWORD,
				inviteToken: token,
			})

			expect(joined.user.workspaceId).toBe(owner.teamId)
			expect(await titles(api, joined.token, "all")).toEqual(["Team memo"])
			resultOf(
				await switchTo(
					api,
					joined.token,
					(await me(api, joined.token)).workspaces.find((w) => w.kind === "personal")!.id,
				),
			)
			expect(await titles(api, joined.token, "sharedWithMe")).toEqual([])
		}))

	it("makes nothing dormant on an install that cannot prove an email", () =>
		inApi(async (sql, api) => {
			const person = await signUp(api, "person@else.test")
			const friend = await signUp(api, "friend@else.test")
			const file = await published(sql, {
				workspaceId: friend.user.workspaceId,
				ownerId: friend.user.id,
				title: "Memo",
			})
			const unprovable = new GrantsUsecase(
				new GrantsRepository(sql),
				buildServeService(sql),
				new RevisionsRepository(sql),
				{
					inviteByEmail: true,
					emailProof: false,
					tx: new TransactionProvider(sql),
					ledger: new LedgerService(new LedgerRepository(sql)),
				},
			)
			await unprovable.create(friend.user.id, { artifactId: file, granteeEmail: "person@else.test", role: "view" })

			expect(await titles(api, person.token, "sharedWithMe")).toEqual(["Memo"])
		}))

	/** As index.ts wires it: share by email to an unknown address only where an email can be proven. */
	const grantsWithProof = (sql: Sql, emailProof: boolean) =>
		new GrantsUsecase(new GrantsRepository(sql), buildServeService(sql), new RevisionsRepository(sql), {
			inviteByEmail: emailProof,
			emailProof,
			tx: new TransactionProvider(sql),
			ledger: new LedgerService(new LedgerRepository(sql)),
		})

	it("refuses a share to an unknown email on an install that cannot prove one, and makes no row for it", () =>
		inApi(async (sql, api) => {
			const friend = await signUp(api, "friend@else.test")
			const file = await published(sql, { workspaceId: friend.user.workspaceId, ownerId: friend.user.id, title: "Hi" })

			await expect(
				grantsWithProof(sql, false).create(friend.user.id, {
					artifactId: file,
					granteeEmail: "stranger@else.test",
					role: "view",
				}),
			).rejects.toBeInstanceOf(RefusalError)
			expect(await sql`SELECT 1 FROM exagram.users WHERE email = 'stranger@else.test'`).toEqual([])
		}))

	it("still shares with an account the Workspace knows on an install that cannot prove an email", () =>
		inApi(async (sql, api) => {
			const owner = await teamOwner(api, "owner@acme.test", "Acme")
			const member = await signUp(api, "m@acme.test")
			await new AuthRepository(sql).joinWorkspace({ userId: member.user.id, workspaceId: owner.teamId, role: "member" })
			const file = await published(sql, { workspaceId: owner.teamId, ownerId: owner.user.id, title: "Team memo" })

			await grantsWithProof(sql, false).create(owner.user.id, {
				artifactId: file,
				granteeEmail: "m@acme.test",
				role: "view",
			})

			const read = await api.call({ method: "GET", path: `/v1/artifacts/${file}`, token: member.token })
			expect(resultOf<{ title: string }>(read).title).toBe("Team memo")
		}))

	it("shares with an unknown email on an install with mail only, asleep until its person confirms the address", () =>
		inApi(async (sql, api) => {
			const friend = await signUp(api, "friend@else.test")
			const file = await published(sql, { workspaceId: friend.user.workspaceId, ownerId: friend.user.id, title: "Hi" })
			await grantsWithProof(sql, true).create(friend.user.id, {
				artifactId: file,
				granteeEmail: "stranger@else.test",
				role: "view",
			})
			const stranger = await signUp(api, "stranger@else.test")
			expect(await titles(api, stranger.token, "sharedWithMe")).toEqual([])

			await proveEmail(sql, stranger.user.id)
			const again = await api.auth.signIn({ email: "stranger@else.test", password: PASSWORD })

			expect(await titles(api, again.token, "sharedWithMe")).toEqual(["Hi"])
		}))

	it("lets a Personal share to an unknown email reach its person once they sign in with Google and read it", () =>
		inApi(async (sql, api) => {
			const friend = await signUp(api, "friend@else.test")
			const file = await published(sql, {
				workspaceId: friend.user.workspaceId,
				ownerId: friend.user.id,
				title: "Hello",
			})
			await grantsFor(sql).create(friend.user.id, {
				artifactId: file,
				granteeEmail: "stranger@else.test",
				role: "view",
			})

			const stranger = await api.auth.signInWithGoogle({ profile: googleProfile("stranger@else.test") })

			const read = await api.call({ method: "GET", path: `/v1/artifacts/${file}`, token: stranger.token })
			expect(resultOf<{ title: string }>(read).title).toBe("Hello")
			expect(
				await sql`SELECT outcome FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
					WHERE c.principal_id = ${stranger.user.id} AND s.artifact_id = ${file}`,
			).toEqual([{ outcome: "served" }])
		}))
})

describe("a claim that races the orphan sweep", () => {
	const seedOrphan = async (sql: Sql, email: string) => {
		const [row] = await sql<{ id: string }[]>`
			INSERT INTO exagram.users (email, name, password_hash, unclaimed, created_at)
			VALUES (${email}, ${email}, ${GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL}, true, now() - interval '30 days')
			RETURNING id`
		await sql`
			INSERT INTO exagram.memberships (user_id, workspace_id, kind, role, invited_at)
			SELECT ${row!.id}, w.id, w.kind, 'member', now() - interval '30 days'
			FROM exagram.workspaces w WHERE w.id = ${await seedWorkspace(sql, "Gone")}`
		return row!.id
	}

	for (const via of ["password", "Google"] as const) {
		it(`answers a ${via} sign-up that waited on the sweep as a fresh sign-up, never a server error`, () =>
			inApi(async (sql, api) => {
				const orphan = await seedOrphan(sql, "late@else.test")
				const before = new Date()
				let signing: Promise<SignedIn | string> = Promise.resolve("not started")

				const swept = await sql.begin(async (tx) => {
					const locked = await lockOrphanInvitedMembers(tx as unknown as Sql, { before })
					expect(locked.map((row) => row.id)).toEqual([orphan])
					signing = (
						via === "password"
							? signUp(api, "late@else.test")
							: api.auth.signInWithGoogle({ profile: googleProfile("late@else.test") })
					).catch((error: Error) => error.message)
					const outcome = await Promise.race([
						signing,
						new Promise((resolve) => setTimeout(() => resolve("waiting"), 400)),
					])
					expect(outcome).toBe("waiting")
					return deleteLockedOrphanInvitedMembers(tx as unknown as Sql, {
						before,
						ids: locked.map((row) => row.id),
						memberships: locked.map((row) => row.memberships),
					})
				})

				expect(swept).toEqual([{ id: orphan }])
				const signedIn = await signing
				expect(typeof signedIn).toBe("object")
				expect((await me(api, (signedIn as SignedIn).token)).workspaceKind).toBe("personal")
			}))
	}
})

describe("review round: what a dormant Grant and an unproven account cannot do", () => {
	it("pushes no change event about a dormant Grant to its grantee until it wakes", () =>
		inApi(async (sql, api) => {
			const person = await signUp(api, "person@else.test")
			const friend = await signUp(api, "friend@else.test")
			const file = await published(sql, {
				workspaceId: friend.user.workspaceId,
				ownerId: friend.user.id,
				title: "Quiet",
			})
			const heard: { t: string; a: string | null; u: string[] | null }[] = []
			const listening = await sql.listen("exagram_changes", (payload) =>
				heard.push(JSON.parse(payload) as (typeof heard)[number]),
			)
			const toPerson = () => heard.filter((notice) => notice.u?.includes(person.user.id))
			try {
				const grants = grantsFor(sql)
				const grant = await grants.create(friend.user.id, {
					artifactId: file,
					granteeEmail: "person@else.test",
					role: "view",
				})
				await grants.updateRole(friend.user.id, grant.id, "edit")
				await sql`SELECT pg_sleep(0.3)`
				expect(toPerson()).toEqual([])

				await proveEmail(sql, person.user.id)
				await api.auth.signIn({ email: "person@else.test", password: PASSWORD })
				await sql`SELECT pg_sleep(0.3)`
				expect(toPerson()).toEqual([expect.objectContaining({ t: "reach", a: file })])
			} finally {
				await listening.unlisten()
			}
		}))

	it("adopts an unproven account whose squatter linked a Google identity for another address, dropping it", () =>
		inApi(async (sql, api) => {
			const squatter = await signUp(api, "victim@corp.test")
			await api.auth.linkGoogleIdentity({
				userId: squatter.user.id,
				profile: { sub: "attacker-sub", email: "attacker@gmail.test", name: "Attacker" },
			})

			const owner = await api.auth.signInWithGoogle({ profile: googleProfile("victim@corp.test") })

			expect(owner.user.id).toBe(squatter.user.id)
			expect(await sql`SELECT subject FROM exagram.user_identities WHERE user_id = ${owner.user.id}`).toEqual([
				{ subject: "sub-victim@corp.test" },
			])
			await expect(
				api.auth.signInWithGoogle({ profile: { sub: "attacker-sub", email: "attacker@gmail.test", name: "Attacker" } }),
			).resolves.toMatchObject({ user: { email: "attacker@gmail.test" } })
		}))

	it("refuses Google adoption of an account that proved its address by Notification Email", () =>
		inApi(async (sql, api) => {
			const person = await signUp(api, "proven@corp.test")
			await proveEmail(sql, person.user.id)
			await expect(api.auth.signInWithGoogle({ profile: googleProfile("proven@corp.test") })).rejects.toMatchObject({
				googleCode: "account_exists",
			})
			expect(await api.auth.resolveSession(person.token)).not.toBeNull()
		}))
})

describe("an account claimed before 000044 counts as proven", () => {
	/**
	 * From before 000044: a password account, a member seeded for a Google claim, and a row only a share made, with an
	 * awake share to the last.
	 */
	const fromBefore000044 = (
		run: (sql: Sql, api: SessionApi, ids: { team: string; legacy: string; unclaimed: string }) => Promise<void>,
	) =>
		withDb(async (sql) => {
			const seeded = await with000046RolledBack(sql, async () => {
				await runHalf(sql, "000044_personal_workspaces.down.sql")
				const workspaceId = await seedWorkspace(sql, "Legacy")
				const [legacy] = await sql<{ id: string }[]>`
					INSERT INTO exagram.users (workspace_id, email, name, password_hash, is_admin)
					VALUES (${workspaceId}, 'legacy@old.test', 'Legacy', ${await new PasswordService().hash(PASSWORD)}, true)
					RETURNING id`
				await sql`INSERT INTO exagram.users (workspace_id, email, name, password_hash)
					VALUES (${workspaceId}, 'seeded@old.test', 'Seeded', ${GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL})`
				const [unclaimed] = await sql<{ id: string }[]>`
					INSERT INTO exagram.users (workspace_id, email, name, password_hash, invited_at)
					VALUES (${workspaceId}, 'unclaimed@old.test', 'unclaimed@old.test', ${GOOGLE_CLAIM_PASSWORD_HASH_SENTINEL}, now())
					RETURNING id`
				const file = await published(sql, { workspaceId, ownerId: legacy!.id, title: "Before 000044" })
				await seedGrant(sql, { artifactId: file, granteeId: unclaimed!.id, createdBy: legacy!.id, role: "view" })
				await runHalf(sql, "000044_personal_workspaces.up.sql")
				return { team: workspaceId, legacy: legacy!.id, unclaimed: unclaimed!.id }
			})
			const api = await startSessionApi(sql)
			try {
				await run(sql, api, seeded)
			} finally {
				await api.close()
			}
		})
	const legacyFlags = (sql: Sql) =>
		sql<{ email: string; legacy: boolean }[]>`
			SELECT email::text, email_proven_legacy AS legacy FROM exagram.users ORDER BY email`

	it("makes a share to a password account from before 000044 live at once, and one to a newer account dormant", () =>
		fromBefore000044(async (sql, api, { team, legacy }) => {
			expect(await sql`SELECT exagram.admin_reset_refused(${legacy}, ${team}) AS refused`).toEqual([{ refused: false }])
			const newer = await signUp(api, "newer@else.test")
			const friend = await signUp(api, "friend@else.test")
			const file = await published(sql, {
				workspaceId: friend.user.workspaceId,
				ownerId: friend.user.id,
				title: "Shared after",
			})
			const grants = grantsFor(sql)
			await grants.create(friend.user.id, { artifactId: file, granteeEmail: "legacy@old.test", role: "view" })
			await grants.create(friend.user.id, { artifactId: file, granteeEmail: "newer@else.test", role: "view" })

			expect(
				await sql`SELECT grantee_id, dormant FROM exagram.grants WHERE artifact_id = ${file} ORDER BY dormant`,
			).toEqual([
				{ grantee_id: legacy, dormant: false },
				{ grantee_id: newer.user.id, dormant: true },
			])
			const signedIn = await api.auth.signIn({ email: "legacy@old.test", password: PASSWORD })
			resultOf(
				await switchTo(
					api,
					signedIn.token,
					(await me(api, signedIn.token)).workspaces.find((w) => w.kind === "personal")!.id,
				),
			)
			expect(await titles(api, signedIn.token, "sharedWithMe")).toEqual(["Shared after"])
			expect(await titles(api, newer.token, "sharedWithMe")).toEqual([])

			await proveEmail(sql, newer.user.id)
			const proven = await api.auth.signIn({ email: "newer@else.test", password: PASSWORD })
			expect(await titles(api, proven.token, "sharedWithMe")).toEqual(["Shared after"])
			expect(await legacyFlags(sql)).toEqual([
				{ email: "friend@else.test", legacy: false },
				{ email: "legacy@old.test", legacy: true },
				{ email: "newer@else.test", legacy: false },
				{ email: "seeded@old.test", legacy: false },
				{ email: "unclaimed@old.test", legacy: false },
			])
		}))

	it("puts to sleep the shares of a row unclaimed before 000044 that a password claims after it", () =>
		fromBefore000044(async (sql, api, { unclaimed }) => {
			const claimed = await signUp(api, "unclaimed@old.test", "Claimer")

			expect(claimed.user.id).toBe(unclaimed)
			expect(await sql`SELECT dormant FROM exagram.grants WHERE grantee_id = ${unclaimed}`).toEqual([{ dormant: true }])
			expect(await titles(api, claimed.token, "sharedWithMe")).toEqual([])
			expect(await sql`SELECT email_proven_legacy FROM exagram.users WHERE id = ${unclaimed}`).toEqual([
				{ email_proven_legacy: false },
			])
		}))
})
