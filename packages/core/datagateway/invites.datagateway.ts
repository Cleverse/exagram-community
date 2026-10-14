import type { InviteRole, InviteVia, WorkspaceInvite } from "../entity/invite"

export type IssuedInviteRow = Omit<WorkspaceInvite, "invitedByName">

export type InsertedInvite =
	| { kind: "created"; row: IssuedInviteRow }
	/** The Workspace already has a usable Invite for that email. */
	| { kind: "conflict" }
	/**
	 * The inviter may not send this Invite, including after a Team change it waited on: an `admin_invite` needs an
	 * active Admin, a `member_invite` an active Member while the Workspace lets Members send it.
	 */
	| { kind: "notAllowed" }

/** Invites, always scoped to the caller's own Workspace by the caller. */
export interface InvitesDatagateway {
	insert(input: {
		workspaceId: string
		email: string
		role: InviteRole
		via: InviteVia
		tokenHash: string
		invitedBy: string
		expiresAt: Date
	}): Promise<InsertedInvite>
	list(workspaceId: string): Promise<WorkspaceInvite[]>
	/**
	 * The renewing Admin becomes the inviter and the Invite an `admin_invite`. Null when no such Invite is in that
	 * Workspace, or the renewing Admin is no longer an active Admin, including after a Team change it waited on.
	 * `heldSeat`: whether it held a Seat before this renewal.
	 */
	renew(input: {
		id: string
		workspaceId: string
		tokenHash: string
		invitedBy: string
		expiresAt: Date
	}): Promise<(IssuedInviteRow & { heldSeat: boolean }) | null>
	countRenewalsBySenderSince(senderId: string, since: Date): Promise<number>
	/** The deleted Invite's email, or null when no such Invite is in that Workspace. */
	delete(id: string, workspaceId: string): Promise<{ id: string; email: string } | null>
	/** Whether the Invite still has that token, has not expired, and is usable. */
	isCurrent(id: string, tokenHash: string): Promise<boolean>
}
