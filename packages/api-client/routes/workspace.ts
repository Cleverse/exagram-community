import { type coreContract } from "@exagram/core/contract"

import {
	type IssuedInvite,
	type IssuedResetLink,
	type LiveWorkspace,
	type Member,
	type MemberList,
	type MemberRole,
	type WorkspaceInvites,
} from "../types"
import { Router } from "../utils/baseRouter"
import { codeOf, failWith, failWithUserMessage } from "../utils/errors"
import { unwrapResult } from "../utils/result"

/** Removed, or refused until someone is named to take over what they own. */
export type RemoveMemberResult = { removed: true } | { removed: false; transferRequired: true }

export class WorkspaceRouter extends Router<typeof coreContract> {
	/**
	 * Anyone in no Team makes one and becomes its Workspace Owner. The session stays in the Workspace it acts in;
	 * `auth.switchWorkspace` moves it. A person already in a Team is refused with 409 `ALREADY_IN_TEAM`, whose message
	 * comes through.
	 */
	async createTeam(input: { name: string }): Promise<LiveWorkspace> {
		try {
			return unwrapResult(await this.client.workspace.createTeam({ body: input }))
		} catch (error) {
			return failWithUserMessage(error, "Could not create the team")
		}
	}

	/** Admins, and Members while Member Invites is on. The Join Link comes back once, here, unless it was emailed. */
	async createInvite(input: { email: string; role: "admin" | "member" }): Promise<IssuedInvite> {
		try {
			return unwrapResult(await this.client.workspace.createInvite({ body: input }))
		} catch (error) {
			return failWithUserMessage(error, "Could not create the invite")
		}
	}

	/** Admin only. Carries whether this install lets the Admin create Reset Links. */
	async listInvites(): Promise<WorkspaceInvites> {
		try {
			return unwrapResult(await this.client.workspace.listInvites({}))
		} catch (error) {
			return failWith(error, "Could not load invites")
		}
	}

	/** Admin only. A new Join Link and expiry; the old link stops working. */
	async renewInvite(input: { inviteId: string }): Promise<IssuedInvite> {
		try {
			return unwrapResult(await this.client.workspace.renewInvite({ params: { id: input.inviteId } }))
		} catch (error) {
			return failWithUserMessage(error, "Could not make a new link")
		}
	}

	/** Admin only. */
	async revokeInvite(input: { inviteId: string }): Promise<{ id: string }> {
		try {
			return unwrapResult(await this.client.workspace.revokeInvite({ params: { id: input.inviteId } }))
		} catch (error) {
			return failWith(error, "Could not revoke the invite")
		}
	}

	/** Admin only, and only while the install allows it. The Reset Link comes back once, here. */
	async createResetLink(input: { email: string }): Promise<IssuedResetLink> {
		try {
			return unwrapResult(await this.client.workspace.createResetLink({ body: input }))
		} catch (error) {
			return failWithUserMessage(error, "Could not create a reset link")
		}
	}

	/** Every Member reads the list; an Admin's answer adds last active and counts. */
	async listMembers(): Promise<MemberList> {
		try {
			return unwrapResult(await this.client.workspace.listMembers({}))
		} catch (error) {
			return failWith(error, "Could not load members")
		}
	}

	/** Admin only. */
	async setMemberRole(input: { userId: string; role: MemberRole }): Promise<Member> {
		try {
			return unwrapResult(
				await this.client.workspace.setMemberRole({ params: { userId: input.userId }, body: { role: input.role } }),
			)
		} catch (error) {
			return failWithUserMessage(error, "Could not change the role")
		}
	}

	/** Admin only. `transferTo` names who takes over what they own, which the API asks for only when they own anything. */
	async removeMember(input: { userId: string; transferTo?: string }): Promise<RemoveMemberResult> {
		try {
			unwrapResult(
				await this.client.workspace.removeMember({
					params: { userId: input.userId },
					body: input.transferTo === undefined ? {} : { transferTo: input.transferTo },
				}),
			)
			return { removed: true }
		} catch (error) {
			if (codeOf(error) === "TRANSFER_REQUIRED") return { removed: false, transferRequired: true }
			return failWithUserMessage(error, "Could not remove the member")
		}
	}
}
