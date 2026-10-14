import { RefusalError } from "@exagram/core/utils/refusal"

import type { AuthDatagateway } from "@exagram/core/datagateway/auth.datagateway"
import type {
	Account,
	LiveWorkspace,
	NewUser,
	SessionUser,
	User,
	UserIdentity,
	Workspace,
} from "@exagram/core/entity/auth"
import type { InvitePreview, InviteRole, InviteVia, TakenInvite } from "@exagram/core/entity/invite"
import type { ResetLinkPreview, TakenResetLink } from "@exagram/core/entity/password-reset"

export interface FakeResetLink {
	userId: string
	tokenHash: string
	createdBy: string | null
	workspaceId: string | null
	expiresAt: Date
}

export interface FakeUser extends Account {
	workspaceId: string
	isAdmin: boolean
}

export interface FakeInvite extends TakenInvite {
	invitedBy: string
	tokenHash: string
	createdAt: Date
	expiresAt: Date
}

/* eslint-disable @typescript-eslint/require-await -- an in-memory double for a Promise-returning port */
export class FakeAuthDatagateway implements AuthDatagateway {
	readonly workspaces: Workspace[] = []
	readonly workspaceOwners = new Map<string, string>()
	readonly users: FakeUser[] = []
	identities: UserIdentity[] = []
	readonly sessions: { id: string; userId: string; tokenHash: string; workspaceId: string; expiresAt: Date }[] = []
	readonly invites: FakeInvite[] = []
	private readonly memberships: { userId: string; workspaceId: string; isAdmin: boolean }[] = []
	/** Reset Links, one per account, as `FakePasswordResets` writes them. */
	readonly resets: FakeResetLink[] = []
	lockCount = 0
	private seq = 0

	private nextId(prefix: string): string {
		this.seq += 1
		return `${prefix}${String(this.seq).padStart(8, "0")}-1111-4111-8111-111111111111`.slice(0, 36)
	}

	async countUsers(): Promise<number> {
		return this.users.length
	}

	async lockSignUps(): Promise<void> {
		this.lockCount += 1
	}

	/** Test setup: an Invite whose Join Link hashes to `tokenHash`. */
	seedInvite(input: {
		workspaceId: string
		email: string
		role?: InviteRole
		via?: InviteVia
		tokenHash: string
		invitedBy: string
		expiresAt?: Date
	}) {
		const invite: FakeInvite = {
			id: this.nextId("i"),
			workspaceId: input.workspaceId,
			email: input.email,
			role: input.role ?? "member",
			via: input.via ?? "admin_invite",
			invitedBy: input.invitedBy,
			tokenHash: input.tokenHash,
			createdAt: new Date(Date.now() + this.seq),
			expiresAt: input.expiresAt ?? new Date(Date.now() + 86_400_000),
		}
		this.invites.push(invite)
		return invite
	}

	async createWorkspace(name: string): Promise<Workspace> {
		const workspace: Workspace = { id: this.nextId("w"), kind: "team", name, createdAt: new Date() }
		this.workspaces.push(workspace)
		return workspace
	}

	async createPersonalWorkspace(): Promise<string> {
		const workspace: Workspace = { id: this.nextId("p"), kind: "personal", name: "Personal", createdAt: new Date() }
		this.workspaces.push(workspace)
		return workspace.id
	}

	private isTeam(workspaceId: string): boolean {
		return this.workspaces.find((w) => w.id === workspaceId)?.kind !== "personal"
	}

	async setWorkspaceOwner(workspaceId: string, userId: string): Promise<void> {
		this.workspaceOwners.set(workspaceId, userId)
	}

	async getWorkspaceById(id: string): Promise<Workspace | null> {
		return this.workspaces.find((w) => w.id === id) ?? null
	}

	async createUser(input: NewUser): Promise<User> {
		if (this.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
			throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" })
		}
		const user: FakeUser = {
			...input,
			id: this.nextId("u"),
			googleLinked: false,
			unclaimed: false,
			earliestInvitingWorkspaceId: null,
			hasLiveMembership: true,
			liveTeamId: this.isTeam(input.workspaceId) ? input.workspaceId : null,
			emailProven: false,
			createdAt: new Date(),
		}
		this.users.push(user)
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- discards the hash, keeps the rest
		const { passwordHash: _ignored, ...rest } = user
		return rest
	}

	async getUserByEmail(email: string): Promise<Account | null> {
		const user = this.users.find((u) => u.email.toLowerCase() === email.toLowerCase())
		if (!user) return null
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { workspaceId: _workspace, isAdmin: _admin, ...account } = user
		return {
			...account,
			googleLinked: this.identities.some((identity) => identity.userId === user.id && identity.provider === "google"),
			emailProven:
				this.emailProofs.has(user.id) ||
				this.identities.some(
					(identity) =>
						identity.userId === user.id &&
						identity.provider === "google" &&
						identity.email.toLowerCase() === user.email.toLowerCase(),
				),
		}
	}

	async clearPasswordHashIfMatches(userId: string, expectedHash: string): Promise<boolean> {
		const user = this.users.find((candidate) => candidate.id === userId)
		if (!user || user.passwordHash !== expectedHash) return false
		user.passwordHash = null
		return true
	}

	async setPasswordHashIfMatches(userId: string, expectedHash: string, passwordHash: string): Promise<boolean> {
		const user = this.users.find((candidate) => candidate.id === userId)
		if (!user || user.passwordHash !== expectedHash) return false
		user.passwordHash = passwordHash
		return true
	}

	async lockUnclaimedAccount(userId: string): Promise<boolean> {
		return this.users.some((candidate) => candidate.id === userId && candidate.unclaimed)
	}

	async lockAccountHoldingCredential(input: {
		userId: string
		passwordHash: string | null
		googleSubject: string | null
	}): Promise<{ liveTeamId: string | null } | null> {
		const user = this.users.find((candidate) => candidate.id === input.userId && !candidate.unclaimed)
		if (!user) return null
		const holdsPassword = input.passwordHash !== null && user.passwordHash === input.passwordHash
		const holdsGoogle =
			input.googleSubject !== null &&
			this.identities.some(
				(identity) =>
					identity.userId === user.id && identity.provider === "google" && identity.subject === input.googleSubject,
			)
		return holdsPassword || holdsGoogle ? { liveTeamId: user.liveTeamId } : null
	}

	async claimUnclaimedAccount(userId: string, name: string | null, passwordHash: string | null): Promise<boolean> {
		const user = this.users.find((candidate) => candidate.id === userId && candidate.unclaimed)
		if (!user) return false
		user.unclaimed = false
		user.earliestInvitingWorkspaceId = null
		user.passwordHash = passwordHash
		user.hasLiveMembership = true
		user.isAdmin = true
		user.liveTeamId = null
		user.workspaceId = await this.createPersonalWorkspace()
		if (name !== null && user.name === user.email) user.name = name
		return true
	}

	async getUserByIdentity(provider: string, subject: string): Promise<UserIdentity | null> {
		return this.identities.find((identity) => identity.provider === provider && identity.subject === subject) ?? null
	}

	async getIdentityEmail(userId: string, provider: string): Promise<string | null> {
		return (
			this.identities.find((identity) => identity.userId === userId && identity.provider === provider)?.email ?? null
		)
	}

	async createUserIdentity(input: { userId: string; provider: string; subject: string; email: string }): Promise<void> {
		if (
			this.identities.some(
				(identity) =>
					(identity.provider === input.provider && identity.subject === input.subject) ||
					(identity.userId === input.userId && identity.provider === input.provider),
			)
		) {
			throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" })
		}
		this.identities.push(input)
	}

	async updateUserIdentityEmail(provider: string, subject: string, email: string): Promise<void> {
		const identity = this.identities.find((item) => item.provider === provider && item.subject === subject)
		if (identity) identity.email = email
	}

	async getUserById(id: string): Promise<User | null> {
		const user = this.users.find((u) => u.id === id && u.hasLiveMembership)
		if (!user) return null
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- discards the hash, keeps the rest
		const { passwordHash: _ignored, ...rest } = user
		return {
			...rest,
			googleLinked: this.identities.some((identity) => identity.userId === id && identity.provider === "google"),
		}
	}

	addMembership(userId: string, workspaceId: string, isAdmin = false): void {
		this.memberships.push({ userId, workspaceId, isAdmin })
	}

	async getLiveTeamId(userId: string): Promise<string | null> {
		return this.users.find((u) => u.id === userId)?.liveTeamId ?? null
	}

	async getUserInWorkspace(id: string, workspaceId: string): Promise<User | null> {
		const user = await this.getUserById(id)
		if (user === null || user.workspaceId === workspaceId) return user
		const held = this.memberships.find((m) => m.userId === id && m.workspaceId === workspaceId)
		return held === undefined ? null : { ...user, workspaceId, isAdmin: held.isAdmin }
	}

	async createSession(input: {
		userId: string
		tokenHash: string
		expiresAt: Date
		passwordHash?: string
	}): Promise<void> {
		const { passwordHash, ...session } = input
		const user = this.users.find((u) => u.id === input.userId)
		if (passwordHash !== undefined && user?.passwordHash !== passwordHash) throw new RefusalError()
		this.sessions.push({ ...session, id: this.nextId("s"), workspaceId: user?.workspaceId ?? "" })
	}

	async getUserBySessionTokenHash(tokenHash: string): Promise<SessionUser | null> {
		const session = this.sessions.find((s) => s.tokenHash === tokenHash && s.expiresAt > new Date())
		const user = session ? await this.getUserById(session.userId) : null
		return session && user ? { ...user, workspaceId: session.workspaceId, sessionId: session.id } : null
	}

	async switchSessionWorkspace(input: { sessionId: string; userId: string; workspaceId: string }): Promise<boolean> {
		const session = this.sessions.find((s) => s.id === input.sessionId && s.userId === input.userId)
		if (!session || (await this.getUserInWorkspace(input.userId, input.workspaceId)) === null) return false
		session.workspaceId = input.workspaceId
		return true
	}

	async listLiveWorkspaces(userId: string): Promise<LiveWorkspace[]> {
		const user = await this.getUserById(userId)
		const workspace = user && this.workspaces.find((w) => w.id === user.workspaceId)
		return user && workspace
			? [{ id: workspace.id, kind: workspace.kind, name: workspace.name, role: user.isAdmin ? "admin" : "member" }]
			: []
	}

	async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
		const index = this.sessions.findIndex((s) => s.tokenHash === tokenHash)
		if (index >= 0) this.sessions.splice(index, 1)
	}

	async promoteToAdmin(userId: string, workspaceId: string): Promise<void> {
		const user = this.users.find((candidate) => candidate.id === userId && candidate.workspaceId === workspaceId)
		if (user) user.isAdmin = true
	}

	async joinWorkspace(input: { userId: string; workspaceId: string; role: InviteRole }): Promise<void> {
		const user = this.users.find((candidate) => candidate.id === input.userId)
		if (!user) return
		user.workspaceId = input.workspaceId
		user.isAdmin = input.role === "admin"
		user.hasLiveMembership = true
		user.liveTeamId = input.workspaceId
	}

	async getInvitePreview(tokenHash: string): Promise<InvitePreview | null> {
		const invite = this.invites.find((item) => item.tokenHash === tokenHash && item.expiresAt > new Date())
		if (!invite) return null
		const workspace = this.workspaces.find((w) => w.id === invite.workspaceId)
		return workspace ? { email: invite.email, role: invite.role, workspaceName: workspace.name } : null
	}

	async getInviteWorkspaceId(tokenHash: string): Promise<string | null> {
		return this.invites.find((item) => item.tokenHash === tokenHash && item.expiresAt > new Date())?.workspaceId ?? null
	}

	async getPendingInviteWorkspaceId(email: string, workspaceId?: string): Promise<string | null> {
		return (
			this.invites
				.filter(
					(item) =>
						item.email.toLowerCase() === email.toLowerCase() &&
						item.expiresAt > new Date() &&
						(workspaceId === undefined || item.workspaceId === workspaceId),
				)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.workspaceId ?? null
		)
	}

	async takeInviteByTokenHash(tokenHash: string): Promise<TakenInvite | null> {
		return this.take(this.invites.findIndex((item) => item.tokenHash === tokenHash && item.expiresAt > new Date()))
	}

	async takePendingInviteByEmail(email: string, workspaceId?: string): Promise<TakenInvite | null> {
		const pending = this.invites
			.filter(
				(item) =>
					item.email.toLowerCase() === email.toLowerCase() &&
					item.expiresAt > new Date() &&
					(workspaceId === undefined || item.workspaceId === workspaceId),
			)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
		return pending[0] ? this.take(this.invites.indexOf(pending[0])) : null
	}

	async getResetLinkPreview(tokenHash: string): Promise<ResetLinkPreview | null> {
		const reset = this.resets.find((item) => item.tokenHash === tokenHash && item.expiresAt > new Date())
		const user = reset ? this.users.find((u) => u.id === reset.userId) : undefined
		const workspace = user ? this.workspaces.find((w) => w.id === user.workspaceId) : undefined
		return user && workspace ? { email: user.email, workspaceName: workspace.name } : null
	}

	async takeResetLinkByTokenHash(tokenHash: string): Promise<TakenResetLink | null> {
		const index = this.resets.findIndex((item) => item.tokenHash === tokenHash && item.expiresAt > new Date())
		if (index < 0) return null
		const [reset] = this.resets.splice(index, 1)
		const holder = reset ? this.users.find((u) => u.id === reset.userId) : undefined
		if (!reset || !holder) return null
		const maker = this.users.find((u) => u.id === reset.createdBy && u.hasLiveMembership)
		return {
			userId: reset.userId,
			email: holder.email,
			createdBy: reset.createdBy,
			workspaceId: reset.workspaceId,
			adminLinkUsable:
				maker?.isAdmin === true &&
				maker.workspaceId === reset.workspaceId &&
				holder.hasLiveMembership &&
				holder.workspaceId === reset.workspaceId &&
				!holder.isAdmin,
		}
	}

	async setPasswordHash(userId: string, passwordHash: string): Promise<boolean> {
		const user = this.users.find((candidate) => candidate.id === userId && !candidate.unclaimed)
		if (!user) return false
		user.passwordHash = passwordHash
		return true
	}

	async deleteSessionsForUser(userId: string): Promise<void> {
		for (let index = this.sessions.length - 1; index >= 0; index -= 1) {
			if (this.sessions[index]?.userId === userId) this.sessions.splice(index, 1)
		}
	}

	readonly unprovenAccessEndedFor: string[] = []

	async endUnprovenAccess(userId: string): Promise<void> {
		await this.deleteSessionsForUser(userId)
		for (let index = this.resets.length - 1; index >= 0; index -= 1) {
			if (this.resets[index]?.userId === userId) this.resets.splice(index, 1)
		}
		this.identities = this.identities.filter((identity) => identity.userId !== userId)
		this.unprovenAccessEndedFor.push(userId)
	}

	/** Accounts an Email Sign-in proved the address of. */
	readonly emailProofs = new Set<string>()

	async recordEmailProof(userId: string): Promise<void> {
		this.emailProofs.add(userId)
	}

	readonly sleptFor: string[] = []

	async sleepUnvouchedGrants(userId: string): Promise<number> {
		this.sleptFor.push(userId)
		return 0
	}

	readonly wokenFor: string[] = []

	async wakeGrants(userId: string): Promise<number> {
		this.wokenFor.push(userId)
		return 0
	}

	private take(index: number): TakenInvite | null {
		if (index < 0) return null
		const [invite] = this.invites.splice(index, 1)
		if (!invite) return null
		return {
			id: invite.id,
			workspaceId: invite.workspaceId,
			email: invite.email,
			role: invite.role,
			via: invite.via,
			invitedBy: invite.invitedBy,
		}
	}
}
