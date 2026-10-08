import {
	inviteCeiling,
	NO_COLLABORATOR_IN_PERSONAL,
	ROLE_RANK,
	rolesOffered,
	strongestRole,
} from "@exagram/core/entity/grant"
import { ConflictError, PersonalRuleError } from "@exagram/core/utils/errors"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { GrantsDatagateway, LiveTarget } from "@exagram/core/datagateway/grants.datagateway"
import type { RevisionsDatagateway } from "@exagram/core/datagateway/revisions.datagateway"
import type { TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import type { Grant, GrantRole, InviteSuggestion } from "@exagram/core/entity/grant"
import type { Access } from "@exagram/core/entity/principal"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

import { holdInvitedMemberCap } from "./invited-member-cap"

export interface CreateGrantInput {
	artifactId?: string
	projectId?: string
	granteeEmail: string
	role: GrantRole
	/** The Owner's pin for a new Artifact Grant (null = follow latest); omitted = the Default Pin. */
	pinnedRevisionId?: string | null
}

type GrantTarget = { artifactId?: string; projectId?: string }

type ShareCharge = string & { readonly __brand: "ShareCharge" }

export interface GrantsUsecaseOptions {
	/**
	 * Sharing with an email outside the Workspace: a Guest when someone holds it, else a Member claimed at their
	 * first Google sign-in or, where the edition allows it, through a Join Link (ADR 0034). Off when neither can
	 * claim the row, since a Guest share alone would then tell which emails have an account.
	 */
	inviteByEmail?: boolean
	/** Keeps a new Member and their first Grant one unit, so a refused Grant leaves no Member behind. */
	tx?: TransactionManager
	now?: () => Date
	/** Records each share by email outside the sender's Workspace, which the cap counts. */
	ledger?: LedgerService
	logError?: (message: string, error: unknown) => void
}

export const SHARE_BY_EMAIL_ACTION = "grant.share_by_email"

/** How many workspace members the Share dialog offers when the caller names no limit. */
const SUGGESTION_LIMIT = 5
const MAX_SUGGESTION_LIMIT = 50

const pgCode = (error: unknown): string | undefined =>
	typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined

const isUniqueViolation = (error: unknown): boolean => pgCode(error) === "23505"

/** The Restricted Shares trigger refuses a grantee outside the allowlist. */
const isCheckViolation = (error: unknown): boolean => pgCode(error) === "23514"

export class GrantsUsecase {
	constructor(
		private readonly grants: GrantsDatagateway,
		private readonly serve: ServeService,
		private readonly revisions: RevisionsDatagateway,
		private readonly options: GrantsUsecaseOptions = {},
	) {}

	private atomic<T>(fn: () => Promise<T>): Promise<T> {
		return this.options.tx ? this.options.tx.atomic(fn) : fn()
	}

	private now(): Date {
		return this.options.now?.() ?? new Date()
	}

	/**
	 * The member an email names in the target's Workspace; otherwise, once `create` has charged the sender, whoever
	 * holds it with a live membership elsewhere (a Guest) or an Invited Member here. The sharer cannot tell those
	 * two apart (ADR 0043).
	 */
	private async resolveGrantee(workspaceId: string, email: string, charge: ShareCharge | null): Promise<string> {
		const known = await this.knownGrantee(workspaceId, email)
		if (known !== null) return known
		if (charge === null) throw new RefusalError()
		const person = await this.grants.findGranteeByEmail(email)
		if (person !== null) return person
		const invited = await this.grants.insertInvitedMember(workspaceId, email)
		const id = invited ?? (await this.grants.findGranteeByEmail(email))
		if (id === null) throw new RefusalError()
		return id
	}

	private async chargeShareByEmail(userId: string, input: CreateGrantInput): Promise<ShareCharge | null> {
		if (this.options.inviteByEmail !== true) return null
		const { workspaceId } = (await this.assertCanInvite(userId, input, input.role)).live
		if ((await this.knownGrantee(workspaceId, input.granteeEmail)) !== null) return null
		const ledger = this.ledger()
		return this.atomic(async () => {
			await holdInvitedMemberCap(this.grants, userId, this.now())
			const callId = await ledger.openCall({
				principal: { kind: "user", id: userId, workspaceId },
				surface: "web",
				action: SHARE_BY_EMAIL_ACTION,
				subject: input.granteeEmail.trim().toLowerCase(),
			})
			return callId as ShareCharge
		})
	}

	private async knownGrantee(workspaceId: string, email: string): Promise<string | null> {
		return (
			(await this.grants.findMemberByEmail(workspaceId, email)) ??
			(await this.grants.findGranteeInWorkspace(workspaceId, email))
		)
	}

	private async settleLoggingFailure(callId: ShareCharge, status: "delivered" | "failed"): Promise<void> {
		const settle = () => this.settle(callId, status)
		await (this.options.tx ? this.options.tx.savepoint(settle) : settle()).catch((error: unknown) => {
			this.options.logError?.("share-by-email settle failed", error)
		})
	}

	private async settle(callId: string, status: "delivered" | "failed"): Promise<void> {
		const ledger = this.ledger()
		if (status === "delivered") {
			await ledger.recordServe({
				callId,
				artifactId: null,
				revisionId: null,
				outcome: "served",
				reason: null,
				form: null,
				detectorVersion: null,
			})
		}
		await ledger.settle({ callId, status, bodySha256: null })
	}

	private ledger(): LedgerService {
		if (this.options.ledger === undefined) throw new Error("GrantsUsecase needs the ledger to share by email")
		return this.options.ledger
	}

	private async liveTarget(userId: string, target: GrantTarget): Promise<LiveTarget> {
		const live = await this.grants.getLiveTargetWorkspace(userId, target)
		if (live === null) throw new RefusalError()
		return live
	}

	/** A Pin must name an approved Revision of that same Artifact; the trigger is the backstop. */
	private async assertPinnable(artifactId: string, pinnedRevisionId: string): Promise<void> {
		const revision = await this.revisions.getInArtifact(pinnedRevisionId, artifactId)
		if (revision === null || revision.status !== "approved") throw new RefusalError()
	}

	/**
	 * The caller's access on the target, or null for none. The artifact half asks visible_artifacts;
	 * the project half asks who owns the project, then the strongest Project Grant the caller holds.
	 */
	private async accessOn(userId: string, target: GrantTarget, unlockHash?: string): Promise<Access | null> {
		if (target.artifactId !== undefined) {
			const resolution = await this.serve.resolveUnledgered({ kind: "user", id: userId }, target.artifactId, unlockHash)
			return resolution?.access ?? null
		}
		if (target.projectId === undefined) return null
		const project = await this.grants.getProjectOwner(target.projectId)
		if (project === null) return null
		if (project.ownerId === userId) return "owner"
		return strongestRole(await this.grants.listProjectRoles(target.projectId, userId))
	}

	/** Managing a Grant (role, removal, pins) stays the Owner's alone. */
	protected async assertOwner(userId: string, target: GrantTarget): Promise<void> {
		if ((await this.accessOn(userId, target)) !== "owner") throw new RefusalError()
	}

	/**
	 * Inviting needs Collaborator or better, and never hands out more than the caller holds (an
	 * Owner invites at any role). Without a role this only asks whether the caller may invite at all.
	 */
	protected async assertCanInvite(
		userId: string,
		target: GrantTarget,
		role?: GrantRole,
	): Promise<{ access: Access; live: LiveTarget }> {
		const live = await this.liveTarget(userId, target)
		const access = await this.accessOn(userId, target)
		const ceiling = access === null ? null : inviteCeiling(access)
		if (access === null || ceiling === null) throw new RefusalError()
		if (role !== undefined && ROLE_RANK[role] > ROLE_RANK[ceiling]) throw new RefusalError()
		if (role !== undefined && !rolesOffered(live.kind).includes(role)) {
			throw new PersonalRuleError(NO_COLLABORATOR_IN_PERSONAL)
		}
		return { access, live }
	}

	/**
	 * The caller's own access on the target; null for none, and for a Guest, who shares nothing. `unlockHash`
	 * lets a reader that Anyone with the link admitted behind a password see the access they hold (ADR 0044).
	 */
	async access(userId: string, target: GrantTarget, unlockHash?: string): Promise<Access | null> {
		if ((await this.grants.getLiveTargetWorkspace(userId, target)) === null) return null
		return this.accessOn(userId, target, unlockHash)
	}

	/**
	 * Anyone who may invite sees who already has access. Which Revision each person is pinned to is
	 * the Owner's business alone, so everyone else reads every Grant as following latest.
	 */
	async list(userId: string, target: GrantTarget): Promise<Grant[]> {
		const { access } = await this.assertCanInvite(userId, target)
		const rows =
			target.artifactId !== undefined
				? await this.grants.listByArtifact(target.artifactId)
				: await this.grants.listByProject(target.projectId as string)
		return access === "owner" ? rows : rows.map((grant) => ({ ...grant, pinnedRevisionId: null }))
	}

	/**
	 * True when the person already reaches the target: for an Artifact, anything the boundary
	 * resolves (a Project Grant included); for a Project, ownership or a Grant on it or its parent.
	 */
	private async reaches(userId: string, target: GrantTarget): Promise<boolean> {
		return (await this.accessOn(userId, target)) !== null
	}

	/** Workspace members not yet on the target, for the Share dialog's quick-invite chips. */
	async suggestions(
		userId: string,
		target: GrantTarget & { query?: string; limit?: number },
	): Promise<InviteSuggestion[]> {
		await this.assertCanInvite(userId, target)
		const { workspaceId } = await this.liveTarget(userId, target)
		const typed = target.query?.trim()
		// The text is matched with ILIKE, so its own wildcards must match literally.
		const query = typed ? typed.replace(/[\\%_]/g, (character) => `\\${character}`) : null
		return this.grants.listInviteSuggestions({
			workspaceId,
			callerId: userId,
			artifactId: target.artifactId ?? null,
			projectId: target.projectId ?? null,
			query,
			limit: Math.min(Math.max(target.limit ?? SUGGESTION_LIMIT, 1), MAX_SUGGESTION_LIMIT),
		})
	}

	/**
	 * Anyone who may invite may name an email outside the Workspace: a Guest when someone holds it, else a new
	 * Member (never an Admin) whose Grant starts working once the row is claimed, by Google or a Join Link.
	 */
	async create(userId: string, input: CreateGrantInput): Promise<Grant> {
		const charge = await this.chargeShareByEmail(userId, input)
		let grant: Grant
		try {
			grant = await this.atomic(() => this.createGrant(userId, input, charge))
		} catch (error) {
			if (charge !== null) await this.settleLoggingFailure(charge, "failed")
			throw error
		}
		if (charge !== null) await this.settleLoggingFailure(charge, "delivered")
		return grant
	}

	private async createGrant(userId: string, input: CreateGrantInput, charge: ShareCharge | null): Promise<Grant> {
		const { access: inviterAccess, live } = await this.assertCanInvite(userId, input, input.role)
		const { workspaceId } = live

		const granteeId = await this.resolveGrantee(workspaceId, input.granteeEmail, charge)
		if (granteeId === userId) throw new RefusalError()
		// A Grant to the target's own Owner means nothing, whoever asks for it.
		if ((await this.accessOn(granteeId, input)) === "owner") throw new RefusalError()
		// Only the Owner layers a Grant on someone who already reaches the target (to pin or narrow
		// them); anyone else could otherwise widen a person's access past what the Owner gave.
		if (inviterAccess !== "owner" && (await this.reaches(granteeId, input))) throw new RefusalError()

		// Only an Artifact Grant carries a pin, and only the Owner may name one. Otherwise the
		// Artifact's Default Pin decides it at grant time, except that a pinned inviter passes on their
		// own pin: nobody shares a Revision they cannot read.
		if (input.pinnedRevisionId !== undefined && (inviterAccess !== "owner" || input.artifactId === undefined))
			throw new RefusalError()
		let pinnedRevisionId: string | null = null
		if (input.artifactId !== undefined) {
			const artifact = await this.grants.getArtifactPinState(input.artifactId)
			if (artifact === null) throw new RefusalError()
			if (input.pinnedRevisionId !== undefined) pinnedRevisionId = input.pinnedRevisionId
			else pinnedRevisionId = artifact.defaultPin === "current" ? artifact.currentRevisionId : null
			if (inviterAccess !== "owner") {
				const own = await this.grants.getUserArtifactPin(input.artifactId, userId)
				if (own === null) throw new RefusalError()
				if (own.pinned) pinnedRevisionId = own.revisionId
			}
		} else if (inviterAccess !== "owner") {
			// A Project Grant carries no pin, so someone pinned on any file it would reach cannot hand
			// the whole Project out: the invitee would read past the pin the Owner set.
			if (await this.grants.hasPinnedGrantUnderProject(input.projectId as string, userId)) throw new RefusalError()
		}
		if (pinnedRevisionId !== null) await this.assertPinnable(input.artifactId as string, pinnedRevisionId)

		let id: string
		try {
			id = await this.grants.insert({
				artifactId: input.artifactId ?? null,
				projectId: input.projectId ?? null,
				granteeId,
				role: input.role,
				pinnedRevisionId,
				createdBy: userId,
			})
		} catch (error) {
			if (isUniqueViolation(error)) throw new ConflictError("This grantee already has a grant here.")
			if (isCheckViolation(error)) throw new RefusalError()
			throw error
		}
		const grant = await this.grants.getById(id)
		if (grant === null) throw new RefusalError()
		// As in list: which Revision anyone is pinned to is the Owner's business alone.
		return inviterAccess === "owner" ? grant : { ...grant, pinnedRevisionId: null }
	}

	async updateRole(userId: string, id: string, role: GrantRole): Promise<Grant> {
		const grant = await this.loadOwnedGrant(userId, id)
		await this.grants.updateRole(grant.id, role)
		const updated = await this.grants.getById(grant.id)
		if (updated === null) throw new RefusalError()
		return updated
	}

	/** Removing the last Grant of someone invited by email who never signed in frees their email again. */
	remove(userId: string, id: string): Promise<string> {
		return this.atomic(async () => {
			const grant = await this.loadOwnedGrant(userId, id)
			const { workspaceId } = await this.liveTarget(userId, {
				artifactId: grant.artifactId ?? undefined,
				projectId: grant.projectId ?? undefined,
			})
			await this.grants.lockPersonMemberships(grant.granteeId)
			await this.grants.remove(grant.id)
			await this.grants.releaseInvitedMembership(grant.granteeId, workspaceId)
			return grant.id
		})
	}

	/** A pin names one approved Revision of the granted Artifact; null means follow latest. */
	async updatePin(userId: string, id: string, pinnedRevisionId: string | null): Promise<Grant> {
		const grant = await this.loadOwnedGrant(userId, id)
		// A Project Grant covers many Artifacts, so no single Revision can pin it.
		if (grant.artifactId === null) throw new RefusalError()
		if (pinnedRevisionId !== null) await this.assertPinnable(grant.artifactId, pinnedRevisionId)
		await this.grants.updatePin(grant.id, pinnedRevisionId)
		const updated = await this.grants.getById(grant.id)
		if (updated === null) throw new RefusalError()
		return updated
	}

	async setDefaultPin(
		userId: string,
		artifactId: string,
		defaultPin: "latest" | "current",
	): Promise<{ artifactId: string; defaultPin: "latest" | "current" }> {
		await this.assertOwner(userId, { artifactId })
		const updated = await this.grants.setArtifactDefaultPin(artifactId, defaultPin)
		if (!updated) throw new RefusalError()
		return { artifactId, defaultPin }
	}

	protected async loadOwnedGrant(userId: string, id: string): Promise<Grant> {
		const grant = await this.grants.getById(id)
		if (grant === null) throw new RefusalError()
		await this.assertOwner(userId, {
			artifactId: grant.artifactId ?? undefined,
			projectId: grant.projectId ?? undefined,
		})
		return grant
	}
}
