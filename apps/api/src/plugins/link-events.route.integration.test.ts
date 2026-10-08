import { createPostgresChangeFeedDeps } from "@exagram/core/repository/postgres/change-feed.repository"
import { LinksRepository } from "@exagram/core/repository/postgres/links.repository"
import { createChangeFeed } from "@exagram/core/services/change-feed.service"
import { mintLinkToken } from "@exagram/core/services/link-token.service"
import { withDb } from "@exagram/core/test/pg"
import { softDeleteArtifact } from "@exagram/core/test/seed"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { fastify } from "fastify"
import { describe, expect, it } from "vitest"

import type { ChangeFeed } from "@exagram/core/services/change-feed.port"

import { registerLinkEventsRoute } from "./link-events.route"

import type { Sql } from "postgres"

/**
 * Opens a real Link stream over the real trigger, LISTEN and ChangeFeed, runs `change`, and returns the
 * rest of the body. The fetch carries a deadline, so a stream that never ends fails instead of hanging.
 */
async function watchLinkThrough(change: (sql: Sql, ids: { linkId: string; artifactId: string }) => Promise<unknown>) {
	let body = ""
	await withDb(async (sql) => {
		const fx = await seedSharing(sql)
		const repo = new LinksRepository(sql)
		const minted = mintLinkToken()
		const linkId = await repo.insert({
			artifactId: fx.artifactId,
			revisionId: fx.revisionOneId,
			tokenHash: minted.tokenHash,
			expiresAt: new Date(Date.now() + 3_600_000),
			maxViews: null,
			createdBy: fx.ownerId,
		})
		const changeFeed = await createChangeFeed(createPostgresChangeFeedDeps(sql))
		const shutdown = new AbortController()
		const app = fastify({ logger: false })
		registerLinkEventsRoute(app, { links: repo, changeFeed, shutdown: shutdown.signal, clientIpHeader: null })
		const origin = await app.listen({ port: 0, host: "127.0.0.1" })
		try {
			const response = await fetch(`${origin}/l/${minted.token}/events`, { signal: AbortSignal.timeout(5_000) })
			expect(response.status).toBe(200)
			const reader: ReadableStreamDefaultReader<Uint8Array> = response.body!.getReader()
			const decoder = new TextDecoder()
			// The opening heartbeat is written after the route subscribed, so the change cannot be missed.
			expect(decoder.decode((await reader.read()).value)).toBe(": \n\n")

			await change(sql, { linkId, artifactId: fx.artifactId })

			for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
				body += decoder.decode(chunk.value)
		} finally {
			shutdown.abort()
			await app.close()
			await changeFeed.close()
		}
	})
	return body
}

const idleFeed: ChangeFeed = {
	subscribeUser: () => () => {},
	subscribeLink: () => () => {},
	isListening: () => true,
	quietMs: () => 0,
	close: async () => {},
}

describe("GET /l/:token/events (integration)", () => {
	it("watches a Link without ledgering or claiming a view, even once its last view is claimed", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new LinksRepository(sql)
			const minted = mintLinkToken()
			const linkId = await repo.insert({
				artifactId: fx.artifactId,
				revisionId: fx.revisionOneId,
				tokenHash: minted.tokenHash,
				expiresAt: new Date(Date.now() + 3_600_000),
				maxViews: 1,
				createdBy: fx.ownerId,
			})
			// The page already claimed the only view.
			await sql`UPDATE exagram.links SET views_used = 1 WHERE id = ${linkId}`
			const shutdown = new AbortController()
			const app = fastify({ logger: false })
			registerLinkEventsRoute(app, {
				links: repo,
				changeFeed: idleFeed,
				shutdown: shutdown.signal,
				clientIpHeader: null,
			})
			const origin = await app.listen({ port: 0, host: "127.0.0.1" })

			const response = await fetch(`${origin}/l/${minted.token}/events`)
			expect(response.status).toBe(200)
			const unknown = await fetch(`${origin}/l/${mintLinkToken().token}/events`)
			expect(unknown.status).toBe(404)

			const [ledger] = await sql<{ calls: number }[]>`SELECT count(*)::int AS calls FROM exagram.ledger_calls`
			const [link] = await sql<
				{ viewsUsed: number }[]
			>`SELECT views_used AS "viewsUsed" FROM exagram.links WHERE id = ${linkId}`
			expect(ledger?.calls).toBe(0)
			expect(link?.viewsUsed).toBe(1)

			shutdown.abort()
			await response.text()
			await app.close()
		})
	})

	it("refuses a revoked Link, an expired Link and one whose Artifact is deleted", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const repo = new LinksRepository(sql)
			const insert = (expiresAt: Date) =>
				repo.insert({
					artifactId: fx.artifactId,
					revisionId: fx.revisionOneId,
					tokenHash: mintLinkToken().tokenHash,
					expiresAt,
					maxViews: null,
					createdBy: fx.ownerId,
				})
			const live = await insert(new Date(Date.now() + 3_600_000))
			const revoked = await insert(new Date(Date.now() + 3_600_000))
			const expired = await insert(new Date(Date.now() - 1_000))
			await repo.revoke(revoked)

			expect(await repo.findWatchableExpiry(live)).toBeInstanceOf(Date)
			expect(await repo.findWatchableExpiry(revoked)).toBeNull()
			expect(await repo.findWatchableExpiry(expired)).toBeNull()

			await sql`UPDATE exagram.artifacts SET deleted_at = now() WHERE id = ${fx.artifactId}`
			expect(await repo.findWatchableExpiry(live)).toBeNull()
		})
	})

	it("sends gone and ends an open stream when the Link is revoked", async () => {
		const body = await watchLinkThrough((sql, { linkId }) => new LinksRepository(sql).revoke(linkId))
		expect(body).toBe('event: state\ndata: {"state":"gone"}\n\n')
	})

	it("sends gone and ends an open stream when the Link's Artifact is soft-deleted", async () => {
		const body = await watchLinkThrough((sql, { artifactId }) => softDeleteArtifact(sql, artifactId))
		expect(body).toBe('event: state\ndata: {"state":"gone"}\n\n')
	})
})
