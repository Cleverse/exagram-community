import { COMMUNITY_CAPABILITIES } from "@exagram/core/contract/auth/types"
import { AnyoneUnlocksRepository } from "@exagram/core/repository/postgres/anyone-unlocks.repository"
import { ArtifactsRepository } from "@exagram/core/repository/postgres/artifacts.repository"
import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { CommentsRepository } from "@exagram/core/repository/postgres/comments.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { GrantsRepository } from "@exagram/core/repository/postgres/grants.repository"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { ProjectsRepository } from "@exagram/core/repository/postgres/projects.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { SearchRepository } from "@exagram/core/repository/postgres/search.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { buildServeService } from "@exagram/core/test/serve-fixtures"
import { DomainError } from "@exagram/core/utils/errors"
import cookie from "@fastify/cookie"
import { OpenAPIHandler } from "@orpc/openapi/fastify"
import { onError, ORPCError } from "@orpc/server"
import { RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins"
import { fastify } from "fastify"

import { createRateCounter } from "../src/mcp/rate"
import { registerBodyLimitParser } from "../src/plugins/body-limit.plugin"
import { SESSION_COOKIE_NAME, sessionPlugin } from "../src/plugins/session.plugin"
import { v1Route } from "../src/plugins/v1.route"
import {
	UNLOCKS_PER_MINUTE_PER_ARTIFACT,
	UNLOCKS_PER_MINUTE_PER_IP,
	createArtifactsRouter,
} from "../src/routers/artifacts.router"
import { createAuthRouter } from "../src/routers/auth.router"
import { createCommentsRouter } from "../src/routers/comments.router"
import { createGrantsRouter } from "../src/routers/grants.router"
import { createLedgerRouter } from "../src/routers/ledger.router"
import { createProjectsRouter } from "../src/routers/projects.router"
import { createRevisionsRouter } from "../src/routers/revisions.router"
import { AnyoneUsecase } from "../src/usecase/artifacts/anyone.usecase"
import { noArtifactRedaction } from "../src/usecase/artifacts/artifact-redaction.port"
import { ArtifactsUsecase } from "../src/usecase/artifacts/artifacts.usecase"
import { SearchUsecase } from "../src/usecase/artifacts/search.usecase"
import { AuthUsecase } from "../src/usecase/auth/auth.usecase"
import { CommentsUsecase } from "../src/usecase/comments.usecase"
import { GrantsUsecase } from "../src/usecase/grants.usecase"
import { LedgerUsecase } from "../src/usecase/ledger.usecase"
import { ProjectsUsecase } from "../src/usecase/projects/projects.usecase"
import { RevisionBodyUsecase } from "../src/usecase/revision-body.usecase"
import { RevisionPreviewUsecase } from "../src/usecase/revision-preview.usecase"
import { RevisionsUsecase } from "../src/usecase/revisions/revisions.usecase"
import { FakeJobQueue, FakeObjectStorage } from "../src/usecase/store.datagateway.fake"

import type { Sql } from "postgres"

export interface ApiResponse {
	status: number
	body: string
	json: { result?: unknown; message?: string; code?: string }
	setCookie: string | string[] | undefined
	cacheControl: string | undefined
}

export const USERCONTENT_SECRET = "u".repeat(32)
export const USERCONTENT_ORIGIN = "https://uc.exagram.test"

export interface SessionApi {
	auth: AuthUsecase
	artifacts: ArtifactsUsecase
	projects: ProjectsUsecase
	ledger: LedgerUsecase
	/** The object store the API reads Revision bodies from, for a test to seed. */
	storage: FakeObjectStorage
	/** `cookies` are sent beside the session cookie, as a browser sends an unlock cookie. */
	call(request: {
		method: "GET" | "POST" | "PATCH"
		path: string
		token?: string
		cookies?: string[]
		/** The caller's address, for the per-IP budgets. */
		ip?: string
		body?: unknown
	}): Promise<ApiResponse>
	close(): Promise<void>
}

export async function startSessionApi(sql: Sql): Promise<SessionApi> {
	const tx = new TransactionProvider(sql)
	const ledgerService = new LedgerService(new LedgerRepository(sql))
	const serve = buildServeService(sql)
	const artifactsRepository = new ArtifactsRepository(sql)
	const storage = new FakeObjectStorage()
	const revisions = new RevisionsUsecase(
		artifactsRepository,
		new RevisionsRepository(sql),
		storage,
		serve,
		tx,
		{ maxBytes: 20971520, recheckBeforeFinalize: true },
		new FakeJobQueue(),
	)
	const auth = new AuthUsecase(
		new AuthRepository(sql),
		new PasswordService(),
		new SessionTokenService(),
		tx,
		{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
		3600,
		{ ledger: ledgerService },
	)
	const artifacts = new ArtifactsUsecase(
		artifactsRepository,
		new ProjectsRepository(sql),
		revisions,
		serve,
		noArtifactRedaction,
		["restricted", "org", "anyone"],
	)
	const grants = new GrantsUsecase(new GrantsRepository(sql), serve, new RevisionsRepository(sql), { tx })
	const projects = new ProjectsUsecase(new ProjectsRepository(sql), tx)
	const ledger = new LedgerUsecase(new LedgerRepository(sql), serve)

	const router = {
		auth: createAuthRouter({
			authUsecase: auth,
			sessionTtlSeconds: 3600,
			cookieSecure: false,
			googleEnabled: false,
			edition: { name: "community", capabilities: COMMUNITY_CAPABILITIES },
			rate: createRateCounter(1000),
			signInRate: createRateCounter(1000),
			tokenPreviewRate: createRateCounter(1000),
			passwordResetRate: createRateCounter(1000),
		}),
		artifacts: createArtifactsRouter({
			artifactsUsecase: artifacts,
			anyoneUsecase: new AnyoneUsecase(
				artifactsRepository,
				new AnyoneUnlocksRepository(sql),
				new PasswordService(),
				tx,
				serve,
			),
			searchUsecase: new SearchUsecase({ searchDatagateway: new SearchRepository(sql) }),
			signedOutRate: createRateCounter(1000),
			unlockIpRate: createRateCounter(UNLOCKS_PER_MINUTE_PER_IP),
			unlockArtifactRate: createRateCounter(UNLOCKS_PER_MINUTE_PER_ARTIFACT),
			cookieSecure: false,
		}),
		revisions: createRevisionsRouter({
			revisionsUsecase: revisions,
			revisionBodyUsecase: new RevisionBodyUsecase(
				serve,
				USERCONTENT_SECRET,
				USERCONTENT_ORIGIN,
				300,
				new RevisionsRepository(sql),
			),
			revisionPreviewUsecase: new RevisionPreviewUsecase(serve, USERCONTENT_SECRET, USERCONTENT_ORIGIN, 300),
			signedOutRate: createRateCounter(1000),
		}),
		comments: createCommentsRouter({ commentsUsecase: new CommentsUsecase(new CommentsRepository(sql), serve) }),
		grants: createGrantsRouter({ grantsUsecase: grants }),
		projects: createProjectsRouter({ projectsUsecase: projects }),
		ledger: createLedgerRouter({ ledgerUsecase: ledger }),
	}
	const handler = new OpenAPIHandler(router, {
		plugins: [new RequestHeadersPlugin(), new ResponseHeadersPlugin()],
		clientInterceptors: [
			onError((error) => {
				if (error instanceof DomainError) {
					throw new ORPCError(error.code, { status: error.statusCode, message: error.message, cause: error })
				}
				if (error instanceof ORPCError) throw error
				throw new ORPCError("INTERNAL_SERVER_ERROR", { cause: error })
			}),
		],
	})

	const app = fastify({ logger: false })
	registerBodyLimitParser(app, 1024 * 1024)
	await app.register(cookie)
	await app.register(sessionPlugin, { authUsecase: auth })
	app.all(
		"/v1/*",
		v1Route(handler, (request) => request.ip),
	)
	await app.ready()

	return {
		auth,
		artifacts,
		projects,
		ledger,
		storage,
		async call({ method, path, token, cookies = [], ip, body }) {
			const jar = [...(token === undefined ? [] : [`${SESSION_COOKIE_NAME}=${token}`]), ...cookies]
			const response = await app.inject({
				method,
				url: path,
				...(ip === undefined ? {} : { remoteAddress: ip }),
				headers: {
					...(jar.length === 0 ? {} : { cookie: jar.join("; ") }),
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				...(body === undefined ? {} : { payload: JSON.stringify(body) }),
			})
			return {
				status: response.statusCode,
				body: response.body,
				json: response.body === "" ? {} : (JSON.parse(response.body) as ApiResponse["json"]),
				setCookie: response.headers["set-cookie"],
				cacheControl: response.headers["cache-control"],
			}
		},
		close: () => app.close(),
	}
}
