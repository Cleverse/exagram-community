import { createHash } from "node:crypto"

import { type TransactionManager } from "@exagram/core/datagateway/transaction.datagateway"
import { type ArtifactKind } from "@exagram/core/entity/artifact"
import { type WithheldReason } from "@exagram/core/entity/principal"
import { type ConnectionsRepository } from "@exagram/core/repository/postgres/connections.repository"
import { needsParseJob } from "@exagram/core/services/extraction.service"
import { type JobQueue } from "@exagram/core/services/jobs.port"
import { type LedgerService } from "@exagram/core/services/ledger/ledger.service"
import {
	type ArtifactForm,
	type ConnectionPrincipal,
	type McpToolUsecase,
	type UploadCompleteResult,
} from "@exagram/mcp"
import { REDACTION_LIMIT_BYTES } from "@exagram/redactor"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { type FastifyInstance } from "fastify"

import { bearerChallenge } from "../oauth/challenge"
import { type McpToolsPort } from "../usecase/mcp-tools.usecase"

import { checkBearer, type IntrospectedToken } from "./bearer"
import { settleMcpCall, withMcpCall } from "./ledger"
import { type RateCounter } from "./rate"
import { buildMcpServer } from "./server"

const MCP_BODY_LIMIT = REDACTION_LIMIT_BYTES + 64 * 1024

export interface McpPluginDeps {
	tx: TransactionManager
	connections: ConnectionsRepository
	ledger: LedgerService
	jobQueue: JobQueue
	usecase: McpToolsPort
	rate: RateCounter
	/** The web app's origin, so a write can hand back the Artifact's page. */
	webOrigin: string
	/** `ENV.REDACTION_ENABLED`: off keeps redaction out of the tool descriptions. */
	redactionEnabled: boolean
	findAccessToken(token: string): Promise<IntrospectedToken | undefined>
}

export function registerMcp(app: FastifyInstance, deps: McpPluginDeps): void {
	for (const method of ["GET", "DELETE"] as const) {
		app.route({
			method,
			url: "/mcp",
			handler(_req, reply) {
				// Stateless: there is no Mcp-Session-Id to resume and no stream to tear down.
				reply.code(405).header("allow", "POST").send({ error: "method_not_allowed" })
			},
		})
	}

	app.route({
		method: "POST",
		url: "/mcp",
		bodyLimit: MCP_BODY_LIMIT,
		async handler(req, reply) {
			const gate = await checkBearer(req.headers.authorization, {
				findAccessToken: (token) => deps.findAccessToken(token),
				findLiveConnectionByGrantId: (grantId) => deps.connections.findLiveByGrantId(grantId),
			})
			if (!gate.ok) {
				return reply.code(gate.status).header("www-authenticate", gate.challenge).send(gate.body)
			}

			if (!deps.rate.take(gate.connection.id)) {
				return reply
					.code(429)
					.header(
						"www-authenticate",
						bearerChallenge({ error: "rate_limited", description: `${deps.rate.perMinute} calls per minute` }),
					)
					.send({ error: "rate_limited", error_description: "This connection has spent its budget for this minute." })
			}

			const principal = {
				kind: "connection" as const,
				id: gate.connection.id,
				folderAccess: gate.connection.folderAccess,
			}
			const wrapped = ledgered(deps, principal, (error) => {
				req.log.error({ event: "mcp:redaction-enqueue-failed", err: error }, "MCP redaction enqueue failed")
			})
			const server = buildMcpServer({
				principal,
				scopes: gate.scopes,
				usecase: wrapped.usecase,
				webOrigin: deps.webOrigin,
				redactionEnabled: deps.redactionEnabled,
				beginCall: () => wrapped.beginCall(),
				stampEmitted: (payload) => wrapped.stampEmitted(payload),
				log: ({ tool, error }) => req.log.error({ event: "mcp:tool-failed", tool, err: error }, "tool threw"),
			})
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
				enableJsonResponse: true,
			})

			reply.raw.on("close", () => {
				void transport.close()
				void server.close()
			})

			reply.hijack()
			await server.connect(transport)
			await transport.handleRequest(req.raw, reply.raw)
		},
	})
}

/**
 * Runs after the complete's transaction commits. A repeat re-sends only a parse still 'queued'
 * (pg-boss dedups by singletonKey, so this recovers a lost job) and never redaction: enqueueRedact
 * resets the Revision's Redacted Text, and the redaction sweep already recovers a lost redact job.
 * The parse job queues redaction itself once it has parsed.
 */
export async function queueUploadProcessing(
	jobQueue: Pick<JobQueue, "enqueueParse" | "enqueueRedact">,
	done: Pick<UploadCompleteResult, "revisionId" | "kind" | "extractionStatus" | "repeated">,
	reportError: (error: unknown) => void,
): Promise<UploadCompleteResult["processingProblem"]> {
	let problem: UploadCompleteResult["processingProblem"]
	if (needsParseJob(done.kind as ArtifactKind) && done.extractionStatus === "queued") {
		try {
			await jobQueue.enqueueParse(done.revisionId)
		} catch (error) {
			reportError(error)
			problem = "parse-not-queued"
		}
	}
	if (!done.repeated) {
		try {
			await jobQueue.enqueueRedact(done.revisionId)
		} catch (error) {
			reportError(error)
			problem ??= "redaction-not-queued"
		}
	}
	return problem
}

/**
 * Opens one ledger_calls row per tool call and settles it with the digest of what was emitted.
 * Every tool also writes its `ledger_serves` rows inside that same transaction — a read writes one
 * per artifact, a write writes one for the artifact it touched, and `project_list`, which names no
 * artifact, writes one row with a null `artifact_id` so no call is invisible in the Ledger.
 */
function ledgered(
	deps: McpPluginDeps,
	principal: ConnectionPrincipal,
	reportError: (error: unknown) => void,
): {
	usecase: McpToolUsecase
	beginCall(): void
	stampEmitted(payload: string): Promise<void>
} {
	const inner = deps.usecase
	let openCallId: string | null = null

	const around = async <T>(
		action: string,
		run: () => Promise<T>,
		record: (
			call: {
				serve(
					id: string | null,
					revisionId: string | null,
					form: ArtifactForm,
					detectorVersion: number | null,
				): Promise<void>
				withhold(id: string | null, reason: WithheldReason): Promise<void>
			},
			value: T,
		) => Promise<void>,
	): Promise<T> => {
		const { callId, value } = await withMcpCall(
			deps.tx,
			deps.ledger,
			{ connectionId: principal.id, action },
			async (call) => {
				const result = await run()
				await record(call, result)
				return result
			},
		)
		await settleMcpCall(deps.ledger, callId, "delivered", null)
		openCallId = callId
		return value
	}

	return {
		usecase: {
			listArtifacts: (p, input) =>
				around(
					"artifact_list",
					() => inner.listArtifacts(p, input),
					async (call, rows) => {
						for (const row of rows) await call.serve(row.artifactId, row.revisionId, row.form, null)
					},
				),
			searchArtifacts: (p, input) =>
				around(
					"artifact_search",
					() => inner.searchArtifacts(p, input),
					async (call, rows) => {
						for (const row of rows) await call.serve(row.artifactId, row.revisionId, row.form, row.detectorVersion)
					},
				),
			readArtifact: (p, artifactId, revision) =>
				around(
					"artifact_read",
					() => inner.readArtifact(p, artifactId, revision),
					async (call, result) => {
						if (result.artifact) {
							await call.serve(
								result.artifact.artifactId,
								result.artifact.revisionId,
								result.artifact.form,
								result.artifact.detectorVersion,
							)
						} else {
							await call.withhold(artifactId, result.reason ?? "out-of-boundary")
						}
					},
				),
			listProjects: (p) =>
				around(
					"project_list",
					() => inner.listProjects(p),
					async (call) => {
						await call.serve(null, null, null, null)
					},
				),
			upload: async (p, input) => {
				const uploaded = await around(
					"artifact_upload",
					() => inner.upload(p, input),
					async (call, uploaded) => {
						if (uploaded.result) await call.serve(uploaded.result.artifactId, uploaded.result.revisionId, null, null)
						else await call.withhold(input.artifactId ?? null, uploaded.reason)
					},
				)
				if (uploaded.result) {
					try {
						await deps.jobQueue.enqueueRedact(uploaded.result.revisionId)
					} catch (error) {
						reportError(error)
					}
				}
				return uploaded
			},
			createUploadUrl: (p, input) =>
				around(
					"artifact_upload_url",
					() => inner.createUploadUrl(p, input),
					async (call, outcome) => {
						if (outcome.result) await call.serve(outcome.result.artifactId, null, null, null)
						else if (outcome.reason) await call.withhold(input.artifactId ?? null, outcome.reason)
						// Its problems come from the arguments alone, before any lookup, so they name no Artifact.
						else await call.withhold(null, "upload-problem")
					},
				),
			completeUpload: async (p, input) => {
				// Storage is read before the Ledger transaction opens; the decision is made inside it.
				const read = await inner.readUpload(p, input)
				const outcome = await around(
					"artifact_upload_complete",
					() => inner.completeUpload(p, input, read),
					async (call, outcome) => {
						if (outcome.result) await call.serve(outcome.result.artifactId, outcome.result.revisionId, null, null)
						else await call.withhold(input.artifactId, outcome.reason ?? "upload-problem")
					},
				)
				if (!outcome.result) return outcome
				const processingProblem = await queueUploadProcessing(deps.jobQueue, outcome.result, reportError)
				return processingProblem ? { ...outcome, result: { ...outcome.result, processingProblem } } : outcome
			},
			removeGrant: (p, grantId) =>
				around(
					"grant_remove",
					() => inner.removeGrant(p, grantId),
					async (call, changed) => {
						if (changed.result) await call.serve(changed.result.artifactId, null, null, null)
						else await call.withhold(null, changed.reason)
					},
				),
			updateGrantRole: (p, grantId, role) =>
				around(
					"grant_update_role",
					() => inner.updateGrantRole(p, grantId, role),
					async (call, changed) => {
						if (changed.result) await call.serve(changed.result.artifactId, null, null, null)
						else await call.withhold(null, changed.reason)
					},
				),
		},
		beginCall: () => {
			openCallId = null
		},
		stampEmitted: async (payload) => {
			if (openCallId === null) return
			await deps.ledger.recordBodyDigest(openCallId, createHash("sha256").update(payload, "utf-8").digest("hex"))
		},
	}
}
