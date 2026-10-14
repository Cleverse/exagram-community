import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { LedgerRepository } from "@exagram/core/repository/postgres/ledger.repository"
import { LedgerService } from "@exagram/core/services/ledger/ledger.service"
import { withDb } from "@exagram/core/test/pg"
import { seedUser } from "@exagram/core/test/seed"
import { describe, expect, it } from "vitest"

import { settleMcpCall, withMcpCall } from "./ledger"

describe("MCP ledger (integration)", () => {
	it("opens one call, records serves in the same transaction, and settles with the body digest", async () => {
		await withDb(async (sql) => {
			const [workspace] = await sql<{ id: string }[]>`
				INSERT INTO exagram.workspaces (name) VALUES ('w') RETURNING id`
			const userId = await seedUser(sql, { workspaceId: workspace!.id, email: "a@example.test", name: "A" })
			const [connection] = await sql<{ id: string }[]>`
				INSERT INTO exagram.connections (user_id, oidc_client_id, oidc_grant_id, name, scopes, workspace_id)
				VALUES (${userId}::uuid, 'c', 'g', 'Claude', ARRAY['read']::text[], exagram.home_workspace(${userId}::uuid))
				RETURNING id`

			const ledger = new LedgerService(new LedgerRepository(sql))
			const tx = new TransactionProvider(sql)
			const missing = "99999999-9999-9999-9999-999999999999"

			const { callId, value } = await withMcpCall(
				tx,
				ledger,
				{ connectionId: connection!.id, action: "artifact_read" },
				async (call) => {
					await call.withhold(missing, "out-of-boundary")
					return "body"
				},
			)
			expect(value).toBe("body")

			await settleMcpCall(ledger, callId, "delivered", "a".repeat(64))

			const [callRow] = await sql<{ surface: string; action: string; status: string; bodySha256: string }[]>`
				SELECT surface, action, status, body_sha256 AS "bodySha256" FROM exagram.ledger_calls WHERE id = ${callId}::uuid`
			expect(callRow!).toMatchObject({ surface: "mcp", action: "artifact_read", status: "delivered" })
			expect(callRow!.bodySha256).toBe("a".repeat(64))

			const serves = await sql<{ artifactId: string; outcome: string; reason: string }[]>`
				SELECT artifact_id AS "artifactId", outcome, reason FROM exagram.ledger_serves WHERE call_id = ${callId}::uuid`
			expect(serves).toEqual([{ artifactId: missing, outcome: "withheld", reason: "out-of-boundary" }])
		})
	})

	it("records the served form and detector version", async () => {
		await withDb(async (sql) => {
			const [workspace] = await sql<{ id: string }[]>`
				INSERT INTO exagram.workspaces (name) VALUES ('w') RETURNING id`
			const userId = await seedUser(sql, { workspaceId: workspace!.id, email: "a@example.test", name: "A" })
			const [connection] = await sql<{ id: string }[]>`
				INSERT INTO exagram.connections (user_id, oidc_client_id, oidc_grant_id, name, scopes, workspace_id)
				VALUES (${userId}::uuid, 'c', 'g', 'Claude', ARRAY['read']::text[], exagram.home_workspace(${userId}::uuid))
				RETURNING id`

			const ledger = new LedgerService(new LedgerRepository(sql))
			const tx = new TransactionProvider(sql)
			const { callId } = await withMcpCall(
				tx,
				ledger,
				{ connectionId: connection!.id, action: "artifact_read" },
				async (call) => {
					await call.serve(
						"99999999-9999-9999-9999-999999999999",
						"88888888-8888-4888-8888-888888888888",
						"redacted",
						1,
					)
				},
			)

			const [serve] = await sql<{ form: string; detectorVersion: number }[]>`
				SELECT form, detector_version AS "detectorVersion"
				FROM exagram.ledger_serves
				WHERE call_id = ${callId}::uuid`
			expect(serve).toEqual({ form: "redacted", detectorVersion: 1 })
		})
	})
})
