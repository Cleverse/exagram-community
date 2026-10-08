import type { EditionCapabilities, EditionName } from "@exagram/core/contract/auth/types"
import type { coreContract as communityContract } from "@exagram/core/contract/edition"
import type { GeneralAccess } from "@exagram/core/entity/artifact"
import type { InviteRole } from "@exagram/core/entity/invite"
import type { TransactionProvider } from "@exagram/core/repository/postgres/db"
import type { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import type { JobQueue } from "@exagram/core/services/jobs.port"
import type { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import type { ObjectStore } from "@exagram/core/services/object-store.service"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

import type { Env } from "./env"
import type { RateCounter } from "./mcp/rate"
import type { BaseContext } from "./plugins/context"
import type { NativeHandoff } from "./plugins/google-auth.route"
import type { ArtifactRedactionPort } from "./usecase/artifacts/artifact-redaction.port"
import type { ArtifactsUsecase } from "./usecase/artifacts/artifacts.usecase"
import type { AuthUsecase } from "./usecase/auth/auth.usecase"
import type { InviteMailer } from "./usecase/workspace/invites.usecase"
import type { Router } from "@orpc/server"
import type { FastifyInstance } from "fastify"
import type { PgBoss } from "pg-boss"
import type { Sql } from "postgres"

/** The router `index.ts` builds and serves. In the full tree it also holds ee procedures (P22). */
export type CommunityRouter = Router<typeof communityContract, BaseContext>

/** What `index.ts` has built before `createEdition` (P23, P35). Both roots take it; Community reads none of it. */
export interface EditionInput {
	env: Env
	sql: Sql
	txManager: TransactionProvider
	grantsRepository: GrantsRepository
	ledgerService: LedgerService
	objectStore: ObjectStore
	serveService: ServeService
	jobQueue: JobQueue
	boss: PgBoss
	/** Logs through the http server; a usecase calls it only once the server exists. */
	warn(event: string, message: string): void
}

/** Built after the edition, since they read edition values. A later task may add a member here (P35). */
export interface LateDeps {
	artifactsUsecase: ArtifactsUsecase
	authUsecase: AuthUsecase
	tokenPreviewRate: RateCounter
}

/** What the shared composition root (`index.ts`) asks of the edition. Nothing here is ee-typed. */
export interface EditionWiring {
	name: EditionName
	capabilities: EditionCapabilities
	signUpMode: "open" | "invite"
	adminPasswordReset: boolean
	inviteRoles: readonly InviteRole[]
	/** Whether a non-Admin may send an Invite (P68). Community keeps Invites to Admins. */
	membersMayInvite: boolean
	/** A share may create an Invited Member with Google off: an Admin's Join Link claims it (ADR 0034). */
	inviteWithoutGoogle: boolean
	/** The Mac client's Google handoff (ADR 0030), built from the Google transaction key; null in Community (P77). */
	nativeHandoff: ((transactionKey: Buffer) => NativeHandoff) | null
	/** What a link preview shows where Cloud shows the Workspace name (P29). */
	workspaceLabel: (workspaceName: string) => string
	/** The name of the Workspace a sign-up without a Workspace key creates (P29). */
	firstWorkspaceName: (accountName: string) => string
	/** Api error sentences that name the Workspace in Cloud (P29, P64). */
	apiCopy: { accountRemoved: string; lastAdmin: string }
	/** Install-wide Connection redaction gate (`McpRepository`'s second argument). */
	redactionEnabled: boolean
	/** The Redaction Setting reads and writes a duplicate needs; Community has none. */
	artifactRedaction: ArtifactRedactionPort
	/** Adds the edition's procedures. The full root checks the merged router against the full contract inside. */
	extendRouter(router: CommunityRouter, late: LateDeps): CommunityRouter
	/** Creates the edition's own pg-boss queues. Awaited right after `createEdition`, before any send. */
	createQueues(boss: PgBoss): Promise<void>
	/** Fastify routes outside oRPC that only this edition serves. Called before the `/v1/*` catch-all. */
	registerRoutes(app: FastifyInstance): void
	/** POST paths under `/v1` the origin guard lets through (a mail provider's one-click unsubscribe). */
	originGuardExemptPaths: readonly string[]
	/** Queues an Invite's email in the caller's transaction; null when Invites are not emailed (P60). */
	inviteMailer: InviteMailer | null
	/** The General Access levels an owner may set; Community has no `org` (ADR 0043). */
	generalAccessLevels: readonly GeneralAccess[]
}
