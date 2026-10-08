import { createHash, createHmac } from "node:crypto"

import { AccessRequestsRepository } from "@exagram/core/repository/postgres/access-requests.repository"
import { AnyoneUnlocksRepository } from "@exagram/core/repository/postgres/anyone-unlocks.repository"
import { ApprovalsRepository } from "@exagram/core/repository/postgres/approvals.repository"
import { ArtifactsRepository } from "@exagram/core/repository/postgres/artifacts.repository"
import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { createPostgresChangeFeedDeps } from "@exagram/core/repository/postgres/change-feed.repository"
import { CommentsRepository } from "@exagram/core/repository/postgres/comments.repository"
import { ConnectionsRepository } from "@exagram/core/repository/postgres/connections.repository"
import { createPool, TransactionProvider } from "@exagram/core/repository/postgres/db"
import { resolveDbEnv } from "@exagram/core/repository/postgres/db.env"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { InvitesRepository } from "@exagram/core/repository/postgres/invites.repository"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { LinksRepository } from "@exagram/core/repository/postgres/links.repository"
import { McpRepository } from "@exagram/core/repository/postgres/mcp.repository"
import { MembersRepository } from "@exagram/core/repository/postgres/members.repository"
import { NotificationsRepository } from "@exagram/core/repository/postgres/notifications.repository"
import { OidcPayloadsRepository } from "@exagram/core/repository/postgres/oidc-payloads.repository"
import { PasswordResetsRepository } from "@exagram/core/repository/postgres/password-resets.repository"
import { ProjectsRepository } from "@exagram/core/repository/postgres/projects.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { SearchRepository } from "@exagram/core/repository/postgres/search.repository"
import { VisibilityRepository } from "@exagram/core/repository/postgres/visibility.repository"
import { GoogleOidcService } from "@exagram/core/services/auth/google-oidc.service"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { createChangeFeed } from "@exagram/core/services/change-feed.service"
import { createPgBossJobQueue, startPgBoss } from "@exagram/core/services/jobs.pgboss.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { ServeService } from "@exagram/core/services/serve/serve.service"
import { FilesystemObjectStore } from "@exagram/core/services/storage/filesystem.object-store"
import { UploadTokenSigner } from "@exagram/core/services/storage/filesystem.upload-token"
import { createObjectStore, createUploadSigner } from "@exagram/core/services/storage/storage.factory"
import { VerifiedUploadStorage } from "@exagram/core/services/storage/verified-upload.storage"
import { createLifecycle } from "@exagram/core/utils/lifecycle"
import cookie from "@fastify/cookie"
import { OpenAPIHandler } from "@orpc/openapi/fastify"
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins"
import { onError } from "@orpc/server"
import { CORSPlugin, RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins"
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4"
import { fastify } from "fastify"
import { v7 as uuidv7 } from "uuid"

import type { RevisionTextReader } from "@exagram/core/services/serve/serve.port"

import { createEdition } from "./edition"
import { ENV } from "./env"
import { inviteByEmail } from "./invite-by-email"
import { createFindAccessToken } from "./mcp/access-token"
import { createBodyStore } from "./mcp/body.store"
import { registerMcp } from "./mcp/mcp.plugin"
import { createRateCounter } from "./mcp/rate"
import { registerOAuthMount } from "./oauth/oauth.plugin"
import { registerProtectedResourceMetadata } from "./oauth/protected-resource.route"
import { createProvider, OAUTH_SCOPES } from "./oauth/provider"
import { registerBodyLimitParser } from "./plugins/body-limit.plugin"
import { toClientError } from "./plugins/client-error"
import { clientIp } from "./plugins/client-ip"
import { GOOGLE_AUTH_REQUESTS_PER_MINUTE, registerGoogleAuthRoutes } from "./plugins/google-auth.route"
import { registerLinkEventsRoute } from "./plugins/link-events.route"
import { registerLinkPageRoute } from "./plugins/link-page.route"
import { loggerOptions } from "./plugins/logger-options"
import { registerOriginGuard } from "./plugins/origin-guard"
import { SIGNED_OUT_READS_PER_MINUTE } from "./plugins/reader"
import { registerReadiness } from "./plugins/readiness.route"
import { sessionPlugin } from "./plugins/session.plugin"
import { registerUnfurlRoute } from "./plugins/unfurl.route"
import { registerUploadRoute } from "./plugins/upload.route"
import { v1Route } from "./plugins/v1.route"
import {
	createAccessRequestsRouter,
	createApprovalsRouter,
	createArtifactsRouter,
	createAuthRouter,
	createCommentsRouter,
	createConnectionsRouter,
	createEventsRouter,
	createGrantsRouter,
	createLedgerRouter,
	createLinksRouter,
	createNotificationsRouter,
	createProjectsRouter,
	createRevisionsRouter,
	createWorkspaceRouter,
} from "./routers"
import { ACCESS_REQUESTS_PER_MINUTE } from "./routers/access-requests.router"
import { UNLOCKS_PER_MINUTE_PER_ARTIFACT, UNLOCKS_PER_MINUTE_PER_IP } from "./routers/artifacts.router"
import {
	PASSWORD_RESET_REQUESTS_PER_MINUTE,
	SIGN_IN_REQUESTS_PER_MINUTE,
	SIGN_UP_REQUESTS_PER_MINUTE,
	TOKEN_PREVIEW_REQUESTS_PER_MINUTE,
} from "./routers/auth.router"
import { createConsentRouter } from "./routers/consent.router"
import { AccessRequestsUsecase } from "./usecase/access-requests.usecase"
import { ApprovalsUsecase } from "./usecase/approvals/approvals.usecase"
import { AnyoneUsecase } from "./usecase/artifacts/anyone.usecase"
import { ArtifactsUsecase } from "./usecase/artifacts/artifacts.usecase"
import { SearchUsecase } from "./usecase/artifacts/search.usecase"
import { AuthUsecase } from "./usecase/auth/auth.usecase"
import { CommentsUsecase } from "./usecase/comments.usecase"
import { ConnectionsUsecase, type GrantRevoker } from "./usecase/connections.usecase"
import { ConsentUsecase } from "./usecase/consent.usecase"
import { GrantsUsecase } from "./usecase/grants.usecase"
import { LedgerUsecase } from "./usecase/ledger.usecase"
import { LinksUsecase } from "./usecase/links.usecase"
import { McpToolsUsecase } from "./usecase/mcp-tools.usecase"
import { NotificationsUsecase } from "./usecase/notifications.usecase"
import { ProjectsUsecase } from "./usecase/projects/projects.usecase"
import { RevisionBodyUsecase } from "./usecase/revision-body.usecase"
import { RevisionPreviewUsecase } from "./usecase/revision-preview.usecase"
import { RevisionsUsecase } from "./usecase/revisions/revisions.usecase"
import { InvitesUsecase } from "./usecase/workspace/invites.usecase"
import { MembersUsecase } from "./usecase/workspace/members.usecase"
import { ResetLinksUsecase } from "./usecase/workspace/reset-links.usecase"

// Resolved once: the pool, its LISTEN connection and pg-boss all connect with the same TLS settings.
const db = resolveDbEnv(ENV)
const sql = createPool({ url: db.url, ssl: db.ssl, max: db.max, onNotice: console.log })

const txManager = new TransactionProvider(sql)
const authRepository = new AuthRepository(sql)
const projectsRepository = new ProjectsRepository(sql)
const artifactsRepository = new ArtifactsRepository(sql)
const revisionsRepository = new RevisionsRepository(sql)
const approvalsRepository = new ApprovalsRepository(sql)
const grantsRepository = new GrantsRepository(sql)
const visibilityRepository = new VisibilityRepository(sql)
const ledgerService = new LedgerService(new LedgerRepository(sql))
const linksRepository = new LinksRepository(sql)

const objectStore = await createObjectStore(ENV)

const revisionTextReader: RevisionTextReader = {
	// Called inside `serve()`'s transaction, so `getVisible` re-reads the row the call already
	// resolved — it is here for the Artifact's kind, which the visibility row does not carry.
	async readText({ principal, artifactId, revisionId, unlockHash }) {
		const artifact = await artifactsRepository.getVisible(principal, artifactId, unlockHash)
		const revision = await revisionsRepository.getById(revisionId)
		if (!artifact || !revision) return null
		if (!["doc", "chat", "html"].includes(artifact.kind)) {
			if (revision.extractionStatus !== "done" || revision.extractedText === null) return null
			return { kind: artifact.kind, mime: revision.mime, text: revision.extractedText }
		}
		const bytes = await objectStore.get(revision.storageKey)
		if (bytes.byteLength !== revision.bytes || createHash("sha256").update(bytes).digest("hex") !== revision.sha256)
			throw new Error(`stored body does not match revision ${revision.id}`)
		return { kind: artifact.kind, mime: revision.mime, text: Buffer.from(bytes).toString("utf8") }
	},
}

const serveService = new ServeService(
	visibilityRepository,
	ledgerService,
	txManager,
	linksRepository,
	revisionTextReader,
)

const boss = await startPgBoss({ connectionString: db.url, ssl: db.ssl })
const jobQueue = createPgBossJobQueue(boss, sql)

const edition = createEdition({
	env: ENV,
	sql,
	txManager,
	grantsRepository,
	ledgerService,
	objectStore,
	serveService,
	jobQueue,
	boss,
	// Usecases call it while serving requests, after `httpServer` exists.
	warn: (event, message) => httpServer.log.warn({ event }, message),
})
await edition.createQueues(boss)

// One LISTEN for this process; readiness stays false until it is up. `drain` ends every open stream
// on shutdown, since `httpServer.close()` otherwise waits on each one until the lifecycle timeout.
const changeFeed = await createChangeFeed(createPostgresChangeFeedDeps(sql))
const drain = new AbortController()

const connectionsRepository = new ConnectionsRepository(sql)
const mcpRepository = new McpRepository(sql, edition.redactionEnabled)
const oidcPayloadsRepository = new OidcPayloadsRepository(sql)

const oidcProvider = createProvider({
	oidcPayloads: oidcPayloadsRepository,
	webOrigin: ENV.WEB_ORIGIN,
	onGrantRevoked: (grantId) => connectionsUsecase.markGrantRevoked(grantId),
	logError: (message, error) => httpServer.log.error({ err: error }, message),
	async findAccountById(accountId) {
		const rows = await sql<{ id: string; email: string; name: string }[]>`
			SELECT id, email, name FROM exagram.users
			WHERE id = ${accountId}::uuid AND exagram.has_live_membership(id)
		`
		return rows[0] ?? null
	},
})

const grantRevoker: GrantRevoker = {
	async revokeGrant(grantId) {
		await oidcPayloadsRepository.revokeGrant(grantId)
	},
}

const consentUsecase = new ConsentUsecase(oidcProvider, connectionsRepository, grantRevoker, OAUTH_SCOPES)

const connectionsUsecase = new ConnectionsUsecase(connectionsRepository, grantRevoker, txManager)

const storage = new VerifiedUploadStorage(
	objectStore,
	await createUploadSigner(ENV, {
		ticketTtlSeconds: ENV.UPLOAD_TICKET_TTL_SECONDS,
		// Same origin as the web app: Caddy in Self-hosted and the Vite proxy in dev both forward /v1.
		...(ENV.UPLOAD_TOKEN_SECRET !== undefined && {
			filesystem: { uploadOrigin: ENV.WEB_ORIGIN, secret: ENV.UPLOAD_TOKEN_SECRET },
		}),
	}),
)

const joiningRepository = new JoiningRepository(sql)
const joinRequestsRepository = new JoinRequestsRepository(sql)
const passwordService = new PasswordService()
const authUsecase = new AuthUsecase(
	authRepository,
	passwordService,
	new SessionTokenService(),
	txManager,
	{ joining: joiningRepository, requests: joinRequestsRepository },
	ENV.SESSION_TTL_SECONDS,
	{
		signUpMode: edition.signUpMode,
		ledger: ledgerService,
		adminPasswordReset: edition.adminPasswordReset,
		firstWorkspaceName: edition.firstWorkspaceName,
		accountRemovedMessage: edition.apiCopy.accountRemoved,
	},
)
const invitesUsecase = new InvitesUsecase(
	authRepository,
	new InvitesRepository(sql),
	joiningRepository,
	ledgerService,
	txManager,
	ENV.WEB_ORIGIN,
	grantsRepository,
	edition.inviteMailer,
	() => new Date(),
	{ inviteRoles: edition.inviteRoles, membersMayInvite: edition.membersMayInvite },
)
const membersUsecase = new MembersUsecase(
	authRepository,
	new MembersRepository(sql),
	ledgerService,
	txManager,
	grantRevoker,
	edition.apiCopy.lastAdmin,
)
const resetLinksUsecase = new ResetLinksUsecase(
	authRepository,
	new PasswordResetsRepository(sql),
	ledgerService,
	txManager,
	ENV.WEB_ORIGIN,
	edition.adminPasswordReset,
)
const projectsUsecase = new ProjectsUsecase(projectsRepository, txManager)
const revisionsUsecase = new RevisionsUsecase(
	artifactsRepository,
	revisionsRepository,
	storage,
	serveService,
	txManager,
	{ maxBytes: ENV.UPLOAD_MAX_BYTES, recheckBeforeFinalize: ENV.STORAGE_DRIVER === "filesystem" },
	jobQueue,
)
const artifactsUsecase = new ArtifactsUsecase(
	artifactsRepository,
	projectsRepository,
	revisionsUsecase,
	serveService,
	edition.artifactRedaction,
	edition.generalAccessLevels,
)
const anyoneUsecase = new AnyoneUsecase(
	artifactsRepository,
	new AnyoneUnlocksRepository(sql),
	passwordService,
	txManager,
	serveService,
)
const searchUsecase = new SearchUsecase({ searchDatagateway: new SearchRepository(sql) })
const approvalsUsecase = new ApprovalsUsecase(approvalsRepository)
// `serveService` is the one P2-22 already built in this file; there is no second instance.
const grantsUsecase = new GrantsUsecase(grantsRepository, serveService, revisionsRepository, {
	inviteByEmail: inviteByEmail({
		googleConfigured: ENV.GOOGLE_CLIENT_ID !== undefined && ENV.GOOGLE_CLIENT_SECRET !== undefined,
		inviteWithoutGoogle: edition.inviteWithoutGoogle,
	}),
	tx: txManager,
	ledger: ledgerService,
	logError: (message, error) => httpServer.log.error({ err: error }, message),
})
// The Grant create joins the unit this opens, so a refused Grant leaves the request open.
const accessRequestsUsecase = new AccessRequestsUsecase(new AccessRequestsRepository(sql), grantsUsecase, txManager)
const commentsUsecase = new CommentsUsecase(new CommentsRepository(sql), serveService)
const notificationsUsecase = new NotificationsUsecase(new NotificationsRepository(sql))
const linksUsecase = new LinksUsecase(linksRepository, serveService, ENV.LINK_ORIGIN)
const ledgerUsecase = new LedgerUsecase(new LedgerRepository(sql), serveService)
const revisionBodyUsecase = new RevisionBodyUsecase(
	serveService,
	ENV.USERCONTENT_TOKEN_SECRET,
	ENV.USERCONTENT_ORIGIN,
	ENV.USERCONTENT_TOKEN_TTL_SEC,
	revisionsRepository,
)
const revisionPreviewUsecase = new RevisionPreviewUsecase(
	serveService,
	ENV.USERCONTENT_TOKEN_SECRET,
	ENV.USERCONTENT_ORIGIN,
	ENV.USERCONTENT_TOKEN_TTL_SEC,
)

// One budget per IP across the three signed-out procedures, so the two routers share the counter.
const signedOutRate = createRateCounter(SIGNED_OUT_READS_PER_MINUTE)

const tokenPreviewRate = createRateCounter(TOKEN_PREVIEW_REQUESTS_PER_MINUTE)

const baseRouter = {
	auth: createAuthRouter({
		authUsecase,
		sessionTtlSeconds: ENV.SESSION_TTL_SECONDS,
		cookieSecure: ENV.SESSION_COOKIE_SECURE,
		googleEnabled: ENV.GOOGLE_CLIENT_ID !== undefined,
		edition: { name: edition.name, capabilities: edition.capabilities },
		rate: createRateCounter(SIGN_UP_REQUESTS_PER_MINUTE),
		signInRate: createRateCounter(SIGN_IN_REQUESTS_PER_MINUTE),
		tokenPreviewRate,
		passwordResetRate: createRateCounter(PASSWORD_RESET_REQUESTS_PER_MINUTE),
	}),
	projects: createProjectsRouter({ projectsUsecase }),
	artifacts: createArtifactsRouter({
		artifactsUsecase,
		anyoneUsecase,
		searchUsecase,
		signedOutRate,
		unlockIpRate: createRateCounter(UNLOCKS_PER_MINUTE_PER_IP),
		unlockArtifactRate: createRateCounter(UNLOCKS_PER_MINUTE_PER_ARTIFACT),
		cookieSecure: ENV.SESSION_COOKIE_SECURE,
	}),
	revisions: createRevisionsRouter({
		revisionsUsecase,
		revisionBodyUsecase,
		revisionPreviewUsecase,
		signedOutRate,
	}),
	approvals: createApprovalsRouter({ approvalsUsecase }),
	grants: createGrantsRouter({ grantsUsecase }),
	accessRequests: createAccessRequestsRouter({
		accessRequestsUsecase,
		rate: createRateCounter(ACCESS_REQUESTS_PER_MINUTE),
	}),
	comments: createCommentsRouter({ commentsUsecase }),
	notifications: createNotificationsRouter({
		notificationsUsecase,
	}),
	links: createLinksRouter({ linksUsecase }),
	ledger: createLedgerRouter({ ledgerUsecase }),
	connections: createConnectionsRouter({ connectionsUsecase }),
	workspace: createWorkspaceRouter({
		invitesUsecase,
		membersUsecase,
		resetLinksUsecase,
	}),
	events: createEventsRouter({ changeFeed, shutdown: drain.signal }),
}

const router = edition.extendRouter(baseRouter, { artifactsUsecase, authUsecase, tokenPreviewRate })

const handler = new OpenAPIHandler(router, {
	// The live feed sends its own `ping` event every 25 s, so oRPC's comment keep-alive would only double it.
	eventIteratorKeepAliveEnabled: false,
	plugins: [
		new CORSPlugin({ origin: () => ENV.WEB_ORIGIN, credentials: true }),
		new RequestHeadersPlugin(),
		new ResponseHeadersPlugin(),
		new OpenAPIReferencePlugin({
			docsPath: "/spec",
			specPath: "/spec/openapi.json",
			docsProvider: "scalar",
			schemaConverters: [new ZodToJsonSchemaConverter()],
			specGenerateOptions: { info: { title: "Exagram API", version: "1.0.0" } },
		}),
	],
	clientInterceptors: [
		onError((error) => {
			throw toClientError(error)
		}),
	],
})

const BODY_LIMIT = 1024 * 1024

const httpServer = fastify({
	logger: loggerOptions(ENV),
	bodyLimit: BODY_LIMIT,
	trustProxy: false,
	genReqId: () => uuidv7(),
	requestIdHeader: "x-request-id",
})

const lifecycle = createLifecycle({
	timeoutSec: ENV.SHUTDOWN_TIMEOUT_SEC,
	close: async () => {
		drain.abort()
		await httpServer.close()
		await changeFeed.close()
		await boss.stop({ graceful: true })
		await sql.end()
	},
	exit: (code) => process.exit(code),
	log: (event, extra) => httpServer.log.error(extra ?? {}, event),
})

lifecycle.install(process)

await httpServer.register(cookie)
await httpServer.register(sessionPlugin, { authUsecase })

registerBodyLimitParser(httpServer, BODY_LIMIT)

registerLinkEventsRoute(httpServer, {
	links: linksRepository,
	changeFeed,
	shutdown: drain.signal,
	clientIpHeader: ENV.CLIENT_IP_HEADER,
})

registerLinkPageRoute(httpServer, {
	links: linksRepository,
	serve: serveService,
	objectStore,
	usercontentOrigin: ENV.USERCONTENT_ORIGIN,
	usercontentSecret: ENV.USERCONTENT_TOKEN_SECRET,
	usercontentTokenTtlSeconds: ENV.USERCONTENT_TOKEN_TTL_SEC,
})

if (ENV.GOOGLE_CLIENT_ID !== undefined && ENV.GOOGLE_CLIENT_SECRET !== undefined) {
	const transactionKey = createHmac("sha256", ENV.OIDC_COOKIE_KEYS)
		.update("exagram/google-oauth-transaction/v1")
		.digest()
	registerGoogleAuthRoutes(httpServer, {
		authUsecase,
		google: new GoogleOidcService(ENV.GOOGLE_CLIENT_ID, ENV.GOOGLE_CLIENT_SECRET),
		apiOrigin: ENV.API_ORIGIN,
		webOrigin: ENV.WEB_ORIGIN,
		sessionTtlSeconds: ENV.SESSION_TTL_SECONDS,
		cookieSecure: ENV.SESSION_COOKIE_SECURE,
		transactionKey,
		native: edition.nativeHandoff ? edition.nativeHandoff(transactionKey) : null,
		rate: createRateCounter(GOOGLE_AUTH_REQUESTS_PER_MINUTE),
		clientIpHeader: ENV.CLIENT_IP_HEADER,
	})
}

if (ENV.STORAGE_DRIVER === "filesystem") {
	// parseEnv already requires the secret for this driver; TypeScript can't see that.
	if (!(objectStore instanceof FilesystemObjectStore) || ENV.UPLOAD_TOKEN_SECRET === undefined) {
		throw new Error("the filesystem storage driver needs its object store and UPLOAD_TOKEN_SECRET")
	}
	// A more specific route than the `/v1/*` catch-all below, so oRPC never sees an upload.
	registerUploadRoute(httpServer, { store: objectStore, tokens: new UploadTokenSigner(ENV.UPLOAD_TOKEN_SECRET) })
}

// Routes only this edition serves; static, so the `/v1/*` catch-all below never sees them.
edition.registerRoutes(httpServer)

// Unauthenticated link previews; a static route, so the `/v1/*` catch-all below never sees it.
registerUnfurlRoute(httpServer, { sql, webOrigin: ENV.WEB_ORIGIN, workspaceLabel: edition.workspaceLabel })

registerOAuthMount(httpServer, oidcProvider)
registerProtectedResourceMetadata(httpServer)

const consentHandler = new OpenAPIHandler(createConsentRouter({ consentUsecase, webOrigin: ENV.WEB_ORIGIN }), {
	plugins: [
		new CORSPlugin({ origin: () => ENV.WEB_ORIGIN, credentials: true }),
		new RequestHeadersPlugin(),
		new ResponseHeadersPlugin(),
	],
	clientInterceptors: [
		onError((error) => {
			throw toClientError(error)
		}),
	],
})

httpServer.all("/oauth/consent/*", async (request, reply) => {
	const { matched } = await consentHandler.handle(request, reply, {
		context: {
			headers: request.headers,
			ip: clientIp(request, ENV.CLIENT_IP_HEADER),
			requestId: request.id,
			user: request.user ?? null,
			raw: { req: request.raw, res: reply.raw },
		},
	})
	if (!matched) reply.status(404).send({ code: "NOT_FOUND", message: "Not found" })
})

registerMcp(httpServer, {
	tx: txManager,
	connections: connectionsRepository,
	ledger: ledgerService,
	rate: createRateCounter(ENV.MCP_RATE_LIMIT_PER_MINUTE),
	webOrigin: ENV.WEB_ORIGIN,
	redactionEnabled: edition.redactionEnabled,
	findAccessToken: createFindAccessToken(oidcProvider),
	jobQueue,
	usecase: new McpToolsUsecase(
		mcpRepository,
		createBodyStore(objectStore),
		(revisionId) =>
			httpServer.log.error({ event: "mcp:body-mismatch", revisionId }, "stored body does not match its Revision"),
		{ storage, maxBytes: ENV.UPLOAD_MAX_BYTES, recheckBeforeFinalize: ENV.STORAGE_DRIVER === "filesystem" },
	),
})

registerReadiness(httpServer, () => lifecycle.isReady() && changeFeed.isListening())

registerOriginGuard(httpServer, {
	prefix: "/v1",
	allowedOrigin: ENV.WEB_ORIGIN,
	exemptPostPaths: [...edition.originGuardExemptPaths],
})

httpServer.all(
	"/v1/*",
	v1Route(handler, (request) => clientIp(request, ENV.CLIENT_IP_HEADER)),
)

// Always 0.0.0.0: inside docker compose "localhost" only resolves to this container itself, so
// other compose services (e.g. web's dev proxy) can't reach the api when it binds there in dev.
await httpServer.listen({ host: "0.0.0.0", port: ENV.HTTP_PORT })
