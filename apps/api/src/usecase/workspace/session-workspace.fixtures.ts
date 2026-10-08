import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { InvitesRepository } from "@exagram/core/repository/postgres/invites.repository"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { MembersRepository } from "@exagram/core/repository/postgres/members.repository"
import { PasswordResetsRepository } from "@exagram/core/repository/postgres/password-resets.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { personalHas } from "@exagram/core/utils/personal-rule"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"

import { addMember, setAdmin } from "../../../test/members"
import { seedPersonalWorkspace } from "../../../test/personal-workspace"
import { AuthUsecase } from "../auth/auth.usecase"

import { InvitesUsecase } from "./invites.usecase"
import { MembersUsecase } from "./members.usecase"
import { ResetLinksUsecase } from "./reset-links.usecase"

import type { Caller } from "./caller"
import type { Sql } from "postgres"

export const PASSWORD = "correct horse battery"
export const ORIGIN = "https://app.example.test"
export const REFUSED = { type: "RefusalError", message: REFUSAL_TEXT }
export const PERSONAL = (feature: string) => ({ type: "PersonalRuleError", message: personalHas(feature) })

export const usecasesFor = (sql: Sql) => {
	const auth = new AuthRepository(sql)
	const ledger = new LedgerService(new LedgerRepository(sql))
	const tx = new TransactionProvider(sql)
	const joining = new JoiningRepository(sql)
	const requests = new JoinRequestsRepository(sql)
	return {
		auth: new AuthUsecase(auth, new PasswordService(), new SessionTokenService(), tx, { joining, requests }, 3600, {
			ledger,
		}),
		members: new MembersUsecase(auth, new MembersRepository(sql), ledger, tx, { revokeGrant: () => Promise.resolve() }),
		invites: new InvitesUsecase(
			auth,
			new InvitesRepository(sql),
			joining,
			ledger,
			tx,
			ORIGIN,
			new GrantsRepository(sql),
			null,
			() => new Date(),
			{ inviteRoles: ["admin", "member"], membersMayInvite: true },
		),
		resetLinks: new ResetLinksUsecase(auth, new PasswordResetsRepository(sql), ledger, tx, ORIGIN, true),
	}
}

export const acme = async (sql: Sql) => {
	const use = usecasesFor(sql)
	const owner = await use.auth.signUp({
		email: "owner@acme.test",
		name: "Olive",
		password: PASSWORD,
		workspaceName: "Acme",
	})
	const teamId = owner.user.workspaceId
	const join = (email: string, name: string) =>
		addMember(sql, use.auth, { workspaceId: teamId, email, name, password: PASSWORD })
	const ada = await join("ada@acme.test", "Ada")
	await setAdmin(sql, ada.user.id, true)
	const mo = await join("mo@acme.test", "Mo")
	const sam = await use.auth.signUp({
		email: "sam@other.test",
		name: "Sam",
		password: PASSWORD,
		workspaceName: "Other",
	})
	const adaPersonal = await seedPersonalWorkspace(sql, ada.user.id)
	const moPersonal = await seedPersonalWorkspace(sql, mo.user.id)
	return { use, teamId, owner: owner.user, ada: ada.user, mo: mo.user, sam: sam.user, adaPersonal, moPersonal }
}

export const openRequest = async (
	sql: Sql,
	workspaceId: string,
	email: string,
	via: "domain" | "member_invite",
	by?: string,
) =>
	(
		await sql<{ id: string }[]>`
			INSERT INTO exagram.join_requests (workspace_id, email, name, password_hash, via, invited_by)
			VALUES (${workspaceId}, ${email}, 'Joiner', 'seeded-hash', ${via}, ${by ?? null}) RETURNING id`
	)[0]!.id

export const outcome = (call: () => Promise<unknown>) =>
	call().then(
		() => "resolved" as const,
		(error: unknown) => ({ type: (error as Error).constructor.name, message: (error as Error).message }),
	)

export const snapshot = async (sql: Sql) => ({
	memberships: [
		...(await sql`SELECT user_id, workspace_id, role, removed_at FROM exagram.memberships ORDER BY user_id, workspace_id`),
	],
	workspaces: [...(await sql`SELECT to_jsonb(w) AS row FROM exagram.workspaces w ORDER BY id`)],
	invites: [...(await sql`SELECT workspace_id, email FROM exagram.workspace_invites ORDER BY email`)],
	requests: [...(await sql`SELECT workspace_id, email, declined_at FROM exagram.join_requests ORDER BY email`)],
	resets: [...(await sql`SELECT user_id FROM exagram.password_resets`)],
	ledger: [...(await sql`SELECT action, workspace_id FROM exagram.ledger_calls ORDER BY started_at, action`)],
})

export const adminCalls = (
	use: ReturnType<typeof usecasesFor>,
	ids: { memberId: string; inviteId: string; memberEmail: string },
) => ({
	"members.setRole": (caller: Caller) => use.members.setRole(caller, ids.memberId, "admin"),
	"members.remove": (caller: Caller) => use.members.remove(caller, ids.memberId, undefined),
	"invites.create": (caller: Caller) => use.invites.create(caller, { email: "new@acme.test", role: "admin" }),
	"invites.list": (caller: Caller) => use.invites.list(caller),
	"invites.renew": (caller: Caller) => use.invites.renew(caller, ids.inviteId),
	"invites.revoke": (caller: Caller) => use.invites.revoke(caller, ids.inviteId),
	"resetLinks.createForMember": (caller: Caller) => use.resetLinks.createForMember(caller, ids.memberEmail),
})
