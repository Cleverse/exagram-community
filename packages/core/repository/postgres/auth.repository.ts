import { toInviteRole, toInviteVia } from "../../entity/invite"
import { RefusalError } from "../../utils/refusal"

import { PostgresRepository } from "./db"
import {
	getLiveTeamId,
	insertPersonalWorkspace,
	lockPersonMemberships,
	claimUnclaimedAccount,
	clearPasswordHashIfMatches,
	endUnprovenAccess,
	holdsGoogleIdentity,
	lockAccountForJoin,
	recordEmailProof,
	lockUnclaimedAccount,
	wakeGrants,
	sleepUnvouchedGrants,
	countUsers,
	deleteSessionByTokenHash,
	deleteSessionsForUser,
	getUserByEmail,
	getUserByIdentity,
	getUserIdentityEmail,
	getUserById,
	getUserInWorkspace,
	getUserBySessionTokenHash,
	listLiveWorkspaces,
	lockMembershipForSwitch,
	switchSessionWorkspace,
	touchUserLastSeen,
	getWorkspaceById,
	insertUserIdentity,
	insertSession,
	insertSessionForPassword,
	insertUser,
	insertWorkspace,
	joinWorkspace,
	lockSignUps,
	promoteUserToAdmin,
	setPasswordHash,
	setWorkspaceOwner,
	setPasswordHashIfMatches,
	updateUserIdentityEmail,
} from "./gen/exagram_auth_sql"
import {
	getInvitePreviewByTokenHash,
	getInviteWorkspaceByTokenHash,
	getPendingInviteWorkspaceByEmail,
	takeInviteByTokenHash,
	takePendingInviteByEmail,
} from "./gen/exagram_invites_sql"
import {
	getPasswordResetPreviewByTokenHash,
	lockResetHolderMemberships,
	takePasswordResetByTokenHash,
} from "./gen/exagram_password_resets_sql"

import type { AuthDatagateway } from "../../datagateway/auth.datagateway"
import type { Account, LiveWorkspace, NewUser, SessionUser, User, Workspace, WorkspaceKind } from "../../entity/auth"
import type { InvitePreview, InviteRole, TakenInvite } from "../../entity/invite"
import type { ResetLinkPreview, TakenResetLink } from "../../entity/password-reset"
import type { Sql } from "postgres"

const LAST_SEEN_THROTTLE_MS = 5 * 60_000

type UserRow = {
	id: string
	workspaceId: string
	email: string
	name: string
	isAdmin: boolean
	googleLinked?: string
	createdAt: Date
}

const toTaken = (
	row: { id: string; workspaceId: string; email: string; role: string; via: string; invitedBy: string } | null,
): TakenInvite | null => (row ? { ...row, role: toInviteRole(row.role), via: toInviteVia(row.via) } : null)

const toUser = (row: UserRow): User => ({
	id: row.id,
	workspaceId: row.workspaceId,
	email: row.email,
	name: row.name,
	isAdmin: row.isAdmin,
	googleLinked: row.googleLinked === undefined ? false : (row.googleLinked as unknown as boolean),
	createdAt: row.createdAt,
})

const toWorkspace = (row: { id: string; kind: string; name: string; createdAt: Date }): Workspace => ({
	id: row.id,
	kind: row.kind as WorkspaceKind,
	name: row.name,
	createdAt: row.createdAt,
})

export class AuthRepository extends PostgresRepository implements AuthDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async countUsers(): Promise<number> {
		const row = await countUsers(this.sql)
		return row?.total ?? 0
	}

	async lockSignUps(): Promise<void> {
		await lockSignUps(this.sql)
	}

	async createWorkspace(name: string): Promise<Workspace> {
		const row = await insertWorkspace(this.sql, { name })
		if (!row) throw new Error("insert workspace returned no row")
		return toWorkspace(row)
	}

	async createPersonalWorkspace(): Promise<string> {
		const row = await insertPersonalWorkspace(this.sql)
		if (!row) throw new Error("insert personal workspace returned no row")
		return row.id
	}

	async setWorkspaceOwner(workspaceId: string, userId: string): Promise<void> {
		await setWorkspaceOwner(this.sql, { id: workspaceId, ownerId: userId })
	}

	async getWorkspaceById(id: string): Promise<Workspace | null> {
		const row = await getWorkspaceById(this.sql, { id })
		return row ? toWorkspace(row) : null
	}

	async createUser(input: NewUser): Promise<User> {
		const row = await insertUser(this.sql, {
			workspaceId: input.workspaceId,
			email: input.email,
			name: input.name,
			passwordHash: input.passwordHash,
			isAdmin: input.isAdmin,
		})
		if (!row) throw new Error("insert user returned no row")
		return toUser(row as UserRow)
	}

	async getUserByEmail(email: string): Promise<Account | null> {
		const row = await getUserByEmail(this.sql, { email })
		return row
			? {
					id: row.id,
					email: row.email,
					name: row.name,
					createdAt: row.createdAt,
					googleLinked: row.googleLinked,
					passwordHash: row.passwordHash,
					unclaimed: row.unclaimed,
					earliestInvitingWorkspaceId: row.earliestInvitingWorkspaceId,
					hasLiveMembership: row.hasLiveMembership,
					liveTeamId: row.liveTeamId,
					emailProven: row.emailProven,
				}
			: null
	}

	async clearPasswordHashIfMatches(userId: string, expectedHash: string): Promise<boolean> {
		// Memberships before the users row, as a Reset Link's use takes them, so an adoption racing one cannot deadlock.
		await lockPersonMemberships(this.sql, { id: userId })
		return (await clearPasswordHashIfMatches(this.sql, { id: userId, expectedHash })) !== null
	}

	async setPasswordHashIfMatches(userId: string, expectedHash: string, passwordHash: string): Promise<boolean> {
		return (await setPasswordHashIfMatches(this.sql, { id: userId, expectedHash, passwordHash })) !== null
	}

	async lockUnclaimedAccount(userId: string): Promise<boolean> {
		return (await lockUnclaimedAccount(this.sql, { id: userId }))?.unclaimed ?? false
	}

	async lockAccountHoldingCredential(input: {
		userId: string
		passwordHash: string | null
		googleSubject: string | null
	}): Promise<{ liveTeamId: string | null } | null> {
		await lockPersonMemberships(this.sql, { id: input.userId })
		const account = await lockAccountForJoin(this.sql, { userId: input.userId, passwordHash: input.passwordHash })
		if (account === null) return null
		// A separate statement: it reads after the row lock, where a sub-select of the locking one would not.
		const holdsGoogle =
			input.googleSubject !== null &&
			(await holdsGoogleIdentity(this.sql, { userId: input.userId, subject: input.googleSubject }))?.held === true
		return account.holdsPassword || holdsGoogle ? { liveTeamId: account.liveTeamId ?? null } : null
	}

	async claimUnclaimedAccount(userId: string, name: string | null, passwordHash: string | null): Promise<boolean> {
		return ((await claimUnclaimedAccount(this.sql, { id: userId, name, passwordHash }))?.id ?? null) !== null
	}

	async getUserByIdentity(provider: string, subject: string) {
		const row = await getUserByIdentity(this.sql, { provider, subject })
		return row ? { userId: row.userId, provider: row.provider, subject: row.subject, email: row.email } : null
	}

	async getIdentityEmail(userId: string, provider: string): Promise<string | null> {
		return (await getUserIdentityEmail(this.sql, { userId, provider }))?.email ?? null
	}

	async createUserIdentity(input: { userId: string; provider: string; subject: string; email: string }): Promise<void> {
		await insertUserIdentity(this.sql, input)
	}

	async updateUserIdentityEmail(provider: string, subject: string, email: string): Promise<void> {
		await updateUserIdentityEmail(this.sql, { provider, subject, email })
	}

	async getUserById(id: string): Promise<User | null> {
		const row = await getUserById(this.sql, { id })
		return row ? toUser(row as UserRow) : null
	}

	async getUserInWorkspace(id: string, workspaceId: string): Promise<User | null> {
		const row = await getUserInWorkspace(this.sql, { id, workspaceId })
		return row ? toUser(row as UserRow) : null
	}

	async getLiveTeamId(userId: string): Promise<string | null> {
		return (await getLiveTeamId(this.sql, { userId }))?.workspaceId ?? null
	}

	async createSession(input: {
		userId: string
		tokenHash: string
		expiresAt: Date
		passwordHash?: string
	}): Promise<void> {
		const { passwordHash, ...session } = input
		const row =
			passwordHash === undefined
				? await insertSession(this.sql, session)
				: await insertSessionForPassword(this.sql, { ...session, passwordHash })
		if (row === null) throw new RefusalError()
	}

	async getUserBySessionTokenHash(tokenHash: string): Promise<SessionUser | null> {
		const row = await getUserBySessionTokenHash(this.sql, { tokenHash })
		if (row === null || row.workspaceId === null) return null
		if (row.lastSeenAt === null || Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
			await touchUserLastSeen(this.sql, { id: row.id, workspaceId: row.workspaceId })
		}
		return { ...toUser(row as UserRow), sessionId: row.sessionId }
	}

	async switchSessionWorkspace(input: { sessionId: string; userId: string; workspaceId: string }): Promise<boolean> {
		return this.sql.begin(async (tx) => {
			if ((await lockMembershipForSwitch(tx, input)) === null) return false
			return (await switchSessionWorkspace(tx, input)) !== null
		})
	}

	async listLiveWorkspaces(userId: string): Promise<LiveWorkspace[]> {
		const rows = await listLiveWorkspaces(this.sql, { userId })
		return rows.map((row) => ({
			id: row.id,
			kind: row.kind as WorkspaceKind,
			name: row.name,
			role: row.role === "admin" ? "admin" : "member",
		}))
	}

	async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
		await deleteSessionByTokenHash(this.sql, { tokenHash })
	}

	async promoteToAdmin(userId: string, workspaceId: string): Promise<void> {
		await promoteUserToAdmin(this.sql, { id: userId, workspaceId })
	}

	async joinWorkspace(input: { userId: string; workspaceId: string; role: InviteRole }): Promise<void> {
		await lockPersonMemberships(this.sql, { id: input.userId })
		await joinWorkspace(this.sql, input)
	}

	async getInvitePreview(tokenHash: string): Promise<InvitePreview | null> {
		const row = await getInvitePreviewByTokenHash(this.sql, { tokenHash })
		return row ? { ...row, role: toInviteRole(row.role) } : null
	}

	async getInviteWorkspaceId(tokenHash: string): Promise<string | null> {
		return (await getInviteWorkspaceByTokenHash(this.sql, { tokenHash }))?.workspaceId ?? null
	}

	async getPendingInviteWorkspaceId(email: string, workspaceId?: string): Promise<string | null> {
		const row = await getPendingInviteWorkspaceByEmail(this.sql, { email, workspaceId: workspaceId ?? null })
		return row?.workspaceId ?? null
	}

	async takeInviteByTokenHash(tokenHash: string): Promise<TakenInvite | null> {
		return toTaken(await takeInviteByTokenHash(this.sql, { tokenHash }))
	}

	async takePendingInviteByEmail(email: string, workspaceId?: string): Promise<TakenInvite | null> {
		return toTaken(await takePendingInviteByEmail(this.sql, { email, workspaceId: workspaceId ?? null }))
	}

	async getResetLinkPreview(tokenHash: string): Promise<ResetLinkPreview | null> {
		return getPasswordResetPreviewByTokenHash(this.sql, { tokenHash })
	}

	async takeResetLinkByTokenHash(tokenHash: string): Promise<TakenResetLink | null> {
		await lockResetHolderMemberships(this.sql, { tokenHash })
		const row = await takePasswordResetByTokenHash(this.sql, { tokenHash })
		return row === null
			? null
			: {
					userId: row.userId,
					email: row.email,
					createdBy: row.createdBy,
					workspaceId: row.workspaceId,
					adminLinkUsable: row.adminLinkUsable,
				}
	}

	async setPasswordHash(userId: string, passwordHash: string): Promise<boolean> {
		return (await setPasswordHash(this.sql, { id: userId, passwordHash })) !== null
	}

	async deleteSessionsForUser(userId: string): Promise<void> {
		await deleteSessionsForUser(this.sql, { userId })
	}

	async endUnprovenAccess(userId: string): Promise<void> {
		await endUnprovenAccess(this.sql, { userId })
	}

	async recordEmailProof(userId: string): Promise<void> {
		await recordEmailProof(this.sql, { userId })
	}

	async wakeGrants(userId: string): Promise<number> {
		return (await wakeGrants(this.sql, { userId }))?.woken ?? 0
	}

	async sleepUnvouchedGrants(userId: string): Promise<number> {
		return (await sleepUnvouchedGrants(this.sql, { userId }))?.slept ?? 0
	}
}
