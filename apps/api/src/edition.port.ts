import type { EditionCapabilities, EditionName } from "@exagram/core/contract/auth/types"
import type { coreContract } from "@exagram/core/contract/edition"
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

/** The router `index.ts` builds and serves; an edition may add procedures to it. */
export type CoreRouter = Router<typeof coreContract, BaseContext>

/** What `index.ts` has built before `createEdition`. An edition root may use any of it or none. */
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

/** Built after the edition, since they read edition values. */
export interface LateDeps {
	artifactsUsecase: ArtifactsUsecase
	authUsecase: AuthUsecase
	tokenPreviewRate: RateCounter
}

/** What the shared composition root (`index.ts`) asks of the edition. Every type here comes from shared code. */
export interface EditionWiring {
	name: EditionName
	capabilities: EditionCapabilities
	signUpMode: "open" | "invite"
	adminPasswordReset: boolean
	inviteRoles: readonly InviteRole[]
	/** Whether a non-Admin may send an Invite. False keeps Invites to Admins. */
	membersMayInvite: boolean
	/** A share may create an Invited Member with Google off: an Admin's Join Link claims it. */
	inviteWithoutGoogle: boolean
	/** Whether `auth.providers` offers Email Sign-in: the edition serves it and the install has mail. */
	emailSignInEnabled: boolean
	/** Whether `auth.providers` offers the iPhone and Mac apps' Sign in with Apple. */
	appleNativeEnabled: boolean
	/** The apps' bundle IDs, the clients account deletion revokes an Apple authorization as. */
	appleNativeClientIds: readonly string[]
	/** The Mac client's Google handoff, built from the Google transaction key; null serves none. */
	nativeHandoff: ((transactionKey: Buffer) => NativeHandoff) | null
	/** The label a link preview shows after the kind, given the Workspace name: that name or a fixed one. */
	workspaceLabel: (workspaceName: string) => string
	/** Api error sentences whose wording the edition picks, such as whether they name the Workspace. */
	apiCopy: { accountRemoved: string; lastAdmin: string }
	/** Install-wide Connection redaction gate (`McpRepository`'s second argument). */
	redactionEnabled: boolean
	/** The Redaction Setting reads and writes a duplicate needs; `noArtifactRedaction` for an edition without one. */
	artifactRedaction: ArtifactRedactionPort
	/** Adds the edition's procedures, if any. A root that adds some checks the merged router against its contract. */
	extendRouter(router: CoreRouter, late: LateDeps): CoreRouter
	/** Creates the edition's own pg-boss queues. Awaited right after `createEdition`, before any send. */
	createQueues(boss: PgBoss): Promise<void>
	/** Fastify routes outside oRPC that only this edition serves. Called before the `/v1/*` catch-all. */
	registerRoutes(app: FastifyInstance): void
	/** POST paths under `/v1` the origin guard lets through (a mail provider's one-click unsubscribe). */
	originGuardExemptPaths: readonly string[]
	/** Queues an Invite's email in the caller's transaction; null when Invites are not emailed. */
	inviteMailer: InviteMailer | null
	/** The General Access levels an owner may set; an edition may leave out `org`. */
	generalAccessLevels: readonly GeneralAccess[]
}
