import { createHash } from "node:crypto"
import { type IncomingMessage, type ServerResponse } from "node:http"

import { type ConnectionsRepository } from "@exagram/core/repository/postgres/connections.repository"
import { BadRequestError, ConsentInteractionGoneError } from "@exagram/core/utils/errors"
import { WorkspaceRefusalError } from "@exagram/core/utils/refusal"
import { errors } from "oidc-provider"

import { mcpResource } from "../oauth/oauth.env"

import type { GrantRevoker } from "./connections.usecase"
import type Provider from "oidc-provider"

export interface RawExchange {
	req: IncomingMessage
	res: ServerResponse
}

export interface ApproveInput {
	name: string
	scopes: string[]
	workspaceId?: string
}

export interface ConsentPerson {
	id: string
	workspaceId: string
}

/**
 * oidc-provider raises `SessionNotFound` for a missing interaction cookie, an expired or unknown
 * interaction and a changed session alike.
 */
const orInteractionGone = async <T>(read: () => Promise<T>): Promise<T> => {
	try {
		return await read()
	} catch (error) {
		if (error instanceof errors.SessionNotFound)
			throw new ConsentInteractionGoneError(error.error_description ?? "interaction not found", { cause: error })
		throw error
	}
}

/**
 * One person answering one interaction always gets the same oidc grant id. Allows that overlap, a double
 * click or a retry that reaches another replica, then agree on one grant, one Connection and one answer
 * for the browser whatever order their writes land in, instead of each binding a grant of its own. The
 * person is part of the id so two accounts can never end up sharing a grant.
 */
const oidcGrantIdFor = (interactionUid: string, userId: string): string =>
	createHash("sha256").update(`consent-grant:${interactionUid}:${userId}`).digest("base64url")

export const defaultConsentWorkspaceId = (person: ConsentPerson): string => person.workspaceId

export class ConsentUsecase {
	constructor(
		private readonly provider: Provider,
		private readonly connections: ConnectionsRepository,
		private readonly grants: GrantRevoker,
		private readonly allowedScopes: readonly string[],
	) {}

	private requestedScopes(details: Awaited<ReturnType<Provider["interactionDetails"]>>): string[] {
		const scope = typeof details.params.scope === "string" ? details.params.scope.split(" ").filter(Boolean) : []
		return scope.filter((s) => s !== "openid")
	}

	async info(raw: RawExchange, uid: string, person: ConsentPerson) {
		const details = await orInteractionGone(() => this.provider.interactionDetails(raw.req, raw.res))
		const clientId = String(details.params.client_id)
		const client = await this.provider.Client.find(clientId)
		const requested = this.requestedScopes(details)
		const connection = await this.connections.findLiveByUserAndClient(person.id, clientId)
		const workspaces = await this.connections.listConsentWorkspaces(person.id)

		return {
			uid,
			clientName: client?.clientName ?? clientId,
			scopes: this.allowedScopes.filter((scope) => requested.includes(scope)),
			resource: typeof details.params.resource === "string" ? details.params.resource : mcpResource(),
			hasNamedFolderAccess: connection?.folderAccess === "named",
			defaultWorkspaceId: defaultConsentWorkspaceId(person),
			currentConnectionWorkspaceId: connection?.workspaceId ?? null,
			workspaces,
		}
	}

	/**
	 * `interactionFinished` writes a 303 straight to the raw response, which a JSON procedure cannot
	 * do without hijacking the reply. `interactionResult` stores the same outcome and hands back the
	 * URL, so the browser performs the redirect and the answer stays a normal JSON body.
	 */
	async approve(raw: RawExchange, person: ConsentPerson, input: ApproveInput) {
		const userId = person.id
		const unknown = input.scopes.filter((scope) => !this.allowedScopes.includes(scope))
		if (unknown.length > 0) throw new BadRequestError(`unknown scope: ${unknown.join(", ")}`)

		const details = await orInteractionGone(() => this.provider.interactionDetails(raw.req, raw.res))
		const requested = this.requestedScopes(details)
		const notRequested = input.scopes.filter((scope) => !requested.includes(scope))
		if (notRequested.length > 0) throw new BadRequestError(`Scope was not requested: ${notRequested.join(", ")}`)

		const clientId = String(details.params.client_id)

		const workspaceId = input.workspaceId ?? defaultConsentWorkspaceId(person)
		const workspaces = await this.connections.listConsentWorkspaces(userId)
		if (!workspaces.some((workspace) => workspace.id === workspaceId)) throw new WorkspaceRefusalError()

		// The outcome goes in first. The interaction can end between the read above and here, when a twin
		// of this Allow has already sent the browser on, and that is found out before anything is bound or
		// destroyed. A Connection written ahead of it would then name a grant the AI tool never received.
		const grantId = oidcGrantIdFor(details.uid, userId)
		const redirectTo = await orInteractionGone(() =>
			this.provider.interactionResult(
				raw.req,
				raw.res,
				{ login: { accountId: userId }, consent: { grantId } },
				{ mergeWithLastSubmission: false },
			),
		)

		const grant = new this.provider.Grant({ accountId: userId, clientId })
		grant.jti = grantId
		// `read`/`write`/`manage` are also declared as provider scopes now (see provider.ts), so a
		// client that echoes them into the authorize request's `scope` param — not just `resource` —
		// needs them satisfied at the OIDC consent-bookkeeping level too, or oidc-provider keeps
		// re-prompting. The minted token itself still carries only the RFC 8707 resource scope below.
		grant.addOIDCScope(["openid", ...input.scopes].join(" "))
		grant.addResourceScope(mcpResource(), input.scopes.join(" "))
		// RFC 6749 3.3 lets the account owner hand back less than the client asked for. oidc-provider's
		// `op_scopes_missing` and `rs_scopes_missing` checks compare the request against granted PLUS
		// rejected ("encountered"), so a scope the owner left unticked has to be recorded as rejected.
		// Left merely absent it stays missing, and the consent prompt is raised again without end.
		const declined = requested.filter((scope) => !input.scopes.includes(scope))
		if (declined.length > 0) {
			grant.rejectOIDCScope(declined.join(" "))
			grant.rejectResourceScope(mcpResource(), declined.join(" "))
		}
		await grant.save()

		// Read before the upsert overwrites `oidc_grant_id`: this is the only way to learn the grant
		// re-consent is about to supersede.
		const previous = await this.connections.findLiveByUserAndClient(userId, clientId)

		const bound = await this.connections.upsert({
			userId,
			oidcClientId: clientId,
			oidcGrantId: grantId,
			name: input.name,
			scopes: input.scopes,
			workspaceId,
		})
		if (bound === null) {
			await this.grants.revokeGrant(grantId)
			throw new WorkspaceRefusalError()
		}

		// Upsert first: a failure here must never leave a Connection pointing at a destroyed grant.
		// The oidc-provider grant just replaced would otherwise keep issuing tokens until it expires.
		if (previous !== null && previous.oidcGrantId !== grantId) {
			await this.grants.revokeGrant(previous.oidcGrantId)
		}

		return { redirectTo }
	}

	async deny(raw: RawExchange) {
		const redirectTo = await orInteractionGone(() =>
			this.provider.interactionResult(
				raw.req,
				raw.res,
				{ error: "access_denied", error_description: "the account owner denied this connection" },
				{ mergeWithLastSubmission: false },
			),
		)
		return { redirectTo }
	}
}
