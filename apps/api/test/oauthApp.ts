import { createHash, generateKeyPairSync, randomUUID } from "node:crypto"
import { createServer, type AddressInfo } from "node:net"

import { AuthRepository } from "@exagram/core/repository/postgres/auth.repository"
import { ConnectionsRepository } from "@exagram/core/repository/postgres/connections.repository"
import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { JoinRequestsRepository } from "@exagram/core/repository/postgres/join-requests.repository"
import { JoiningRepository } from "@exagram/core/repository/postgres/joining.repository"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { McpRepository } from "@exagram/core/repository/postgres/mcp.repository"
import { OidcPayloadsRepository } from "@exagram/core/repository/postgres/oidc-payloads.repository"
import { PasswordService } from "@exagram/core/services/auth/password.service"
import { SessionTokenService } from "@exagram/core/services/auth/session-token.service"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import cookie from "@fastify/cookie"
import { OpenAPIHandler } from "@orpc/openapi/fastify"
import { onError } from "@orpc/server"
import { CORSPlugin, RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins"
import { fastify, type FastifyInstance } from "fastify"
import { type Sql } from "postgres"

import type { JobQueue } from "@exagram/core/services/jobs.port"
import type { ObjectStorage } from "@exagram/core/services/storage/object-storage.port"

import { createFindAccessToken } from "../src/mcp/access-token"
import { registerMcp } from "../src/mcp/mcp.plugin"
import { createRateCounter } from "../src/mcp/rate"
import { resetOAuthEnv } from "../src/oauth/oauth.env"
import { registerOAuthMount } from "../src/oauth/oauth.plugin"
import { registerProtectedResourceMetadata } from "../src/oauth/protected-resource.route"
import { createProvider, OAUTH_SCOPES } from "../src/oauth/provider"
import { registerBodyLimitParser } from "../src/plugins/body-limit.plugin"
import { toClientError } from "../src/plugins/client-error"
import { sessionPlugin } from "../src/plugins/session.plugin"
import { createConnectionsRouter } from "../src/routers/connections.router"
import { createConsentRouter } from "../src/routers/consent.router"
import { AuthUsecase } from "../src/usecase/auth/auth.usecase"
import { ConnectionsUsecase, type GrantRevoker } from "../src/usecase/connections.usecase"
import { ConsentUsecase } from "../src/usecase/consent.usecase"
import { McpToolsUsecase } from "../src/usecase/mcp-tools.usecase"

import type Provider from "oidc-provider"

export interface OAuthTestApp {
	app: FastifyInstance
	provider: Provider
	connections: ConnectionsRepository
	bodies: Map<string, string>
	redactionEnqueues: string[]
	parseEnqueues: string[]
	/** What a client PUT to an upload URL; set an entry to stand in for the PUT. */
	uploads: Map<string, { body: Buffer; mime: string }>
	/** Every ticket signed, in order. */
	tickets: { storageKey: string; mime: string; bytes: number }[]
	origin: string
	close(): Promise<void>
}

/**
 * `{"keys":[]}` is a valid placeholder for endpoints that never sign anything, but the `openid`
 * scope always mints a signed ID Token, and with no signing key oidc-provider refuses every client
 * registration outright. One RSA key generated per test run stands in for the real deploy-time JWKS.
 */
function testJwks(): string {
	const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
	const jwk = privateKey.export({ format: "jwk" }) as Record<string, unknown>
	return JSON.stringify({ keys: [{ ...jwk, kid: randomUUID(), use: "sig", alg: "RS256" }] })
}

async function freePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const probe = createServer()
		probe.once("error", reject)
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as AddressInfo
			probe.close(() => resolve(port))
		})
	})
}

export async function startOAuthApp(
	sql: Sql,
	options: { jobQueue?: JobQueue; redactionEnabled?: boolean } = {},
): Promise<OAuthTestApp> {
	const port = await freePort()
	const origin = `http://127.0.0.1:${port}`
	Object.assign(process.env, {
		API_ORIGIN: origin,
		OIDC_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
		OIDC_JWKS: process.env.OIDC_JWKS ?? testJwks(),
	})
	resetOAuthEnv()

	const app = fastify({ logger: false })
	// A plain no-op wildcard parser leaves `request.raw` already drained by Fastify's own body
	// handling, so oidc-provider (which reads the raw stream itself) sees an empty body. This
	// buffers the body and rehangs it on `request.raw`, exactly as production does.
	registerBodyLimitParser(app, 1024 * 1024)

	await app.register(cookie)
	// The consent router's `requireUser` middleware reads `request.user`, which only the real
	// session plugin (cookie -> hashed lookup) sets; `seedSignedInUser` writes a session row this
	// resolves the same way production does.
	await app.register(sessionPlugin, {
		authUsecase: new AuthUsecase(
			new AuthRepository(sql),
			new PasswordService(),
			new SessionTokenService(),
			new TransactionProvider(sql),
			{ joining: new JoiningRepository(sql), requests: new JoinRequestsRepository(sql) },
			86400,
		),
	})

	const webOrigin = "http://localhost:5173"
	const oidcPayloads = new OidcPayloadsRepository(sql)
	const provider = createProvider({
		oidcPayloads,
		webOrigin,
		onGrantRevoked: (grantId) => connectionsUsecase.markGrantRevoked(grantId),
		logError: (message, error) => app.log.error({ err: error }, message),
		async findAccountById(accountId) {
			const rows = await sql<{ id: string; email: string; name: string }[]>`
				SELECT id, email, name FROM exagram.users WHERE id = ${accountId}::uuid
			`
			return rows[0] ?? null
		},
	})

	const connections = new ConnectionsRepository(sql)
	registerOAuthMount(app, provider)
	registerProtectedResourceMetadata(app)

	const grantRevoker: GrantRevoker = {
		async revokeGrant(grantId) {
			await oidcPayloads.revokeGrant(grantId)
		},
	}
	const connectionsUsecase = new ConnectionsUsecase(connections, grantRevoker, new TransactionProvider(sql))
	const consentUsecase = new ConsentUsecase(provider, connections, grantRevoker, OAUTH_SCOPES)
	const consentHandler = new OpenAPIHandler(createConsentRouter({ consentUsecase, webOrigin }), {
		plugins: [
			new CORSPlugin({ origin: () => webOrigin, credentials: true }),
			new RequestHeadersPlugin(),
			new ResponseHeadersPlugin(),
		],
		clientInterceptors: [
			onError((error) => {
				throw toClientError(error)
			}),
		],
	})
	app.all("/oauth/consent/*", async (request, reply) => {
		const { matched } = await consentHandler.handle(request, reply, {
			context: {
				headers: request.headers,
				ip: request.ip,
				requestId: request.id,
				user: request.user ?? null,
				raw: { req: request.raw, res: reply.raw },
			},
		})
		if (!matched) reply.status(404).send({ code: "NOT_FOUND", message: "Not found" })
	})
	const connectionsHandler = new OpenAPIHandler(
		createConnectionsRouter({
			connectionsUsecase,
		}),
		{
			clientInterceptors: [
				onError((error) => {
					throw toClientError(error)
				}),
			],
		},
	)
	app.all("/v1/connections/*", async (request, reply) => {
		const { matched } = await connectionsHandler.handle(request, reply, {
			prefix: "/v1",
			context: { headers: request.headers, ip: request.ip, requestId: request.id, user: request.user ?? null },
		})
		if (!matched) reply.status(404).send({ code: "NOT_FOUND", message: "Not found" })
	})

	const bodies = { bodies: new Map<string, string>() }
	const redactionEnqueues: string[] = []
	const parseEnqueues: string[] = []
	const uploads = new Map<string, { body: Buffer; mime: string }>()
	const tickets: { storageKey: string; mime: string; bytes: number }[] = []
	const storage: ObjectStorage = {
		createUploadTicket: (input) => {
			tickets.push(input)
			return Promise.resolve({
				url: `https://uploads.test/${input.storageKey}?sig=x`,
				storageKey: input.storageKey,
				expiresInSeconds: 900,
				requiredHeaders: { "content-type": input.mime, "content-length": String(input.bytes) },
			})
		},
		readVerified: ({ storageKey, maxBytes }) => {
			const stored = uploads.get(storageKey)
			if (!stored || stored.body.byteLength > maxBytes) return Promise.resolve(null)
			return Promise.resolve({
				body: stored.body,
				bytes: stored.body.byteLength,
				mime: stored.mime,
				sha256: createHash("sha256").update(stored.body).digest("hex"),
			})
		},
		put: ({ storageKey, bytes, mime }) => {
			uploads.set(storageKey, { body: bytes, mime })
			return Promise.resolve()
		},
		exists: (storageKey) => Promise.resolve(uploads.has(storageKey)),
		delete: (storageKey) => {
			uploads.delete(storageKey)
			return Promise.resolve()
		},
	}
	const jobQueue: JobQueue = options.jobQueue ?? {
		enqueueParse: (revisionId) => {
			parseEnqueues.push(revisionId)
			return Promise.resolve()
		},
		enqueueRedact: async (revisionId) => {
			const [revision] = await sql<{ id: string }[]>`
				SELECT id FROM exagram.revisions WHERE id = ${revisionId}::uuid
			`
			if (!revision) throw new Error("revision was not committed before redaction enqueue")
			redactionEnqueues.push(revision.id)
			await sql`
				UPDATE exagram.revisions
				SET redaction_status = 'queued', redaction_queued_at = now()
				WHERE id = ${revisionId}::uuid
			`
		},
		enqueueClaimedRedact: async () => {},
	}
	registerMcp(app, {
		tx: new TransactionProvider(sql),
		connections,
		ledger: new LedgerService(new LedgerRepository(sql)),
		jobQueue,
		rate: createRateCounter(60),
		webOrigin,
		redactionEnabled: options.redactionEnabled ?? true,
		findAccessToken: createFindAccessToken(provider),
		usecase: new McpToolsUsecase(
			new McpRepository(sql, options.redactionEnabled ?? true),
			{
				read: (key) => Promise.resolve(bodies.bodies.get(key) ?? ""),
				write: ({ storageKey, body }) => {
					bodies.bodies.set(storageKey, body)
					return Promise.resolve()
				},
				remove: (key) => {
					bodies.bodies.delete(key)
					return Promise.resolve()
				},
			},
			undefined,
			{ storage, maxBytes: 20 * 1024 * 1024, recheckBeforeFinalize: true },
		),
	})

	await app.listen({ port, host: "127.0.0.1" })
	return {
		app,
		provider,
		connections,
		bodies: bodies.bodies,
		redactionEnqueues,
		parseEnqueues,
		uploads,
		tickets,
		origin,
		close: () => app.close(),
	}
}
