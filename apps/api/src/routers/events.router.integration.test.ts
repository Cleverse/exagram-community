import { randomUUID } from "node:crypto"

import { createPostgresChangeFeedDeps } from "@exagram/core/repository/postgres/change-feed.repository"
import { RevisionsRepository } from "@exagram/core/repository/postgres/revisions.repository"
import { createChangeFeed } from "@exagram/core/services/change-feed.service"
import { pgUrl, withDb } from "@exagram/core/test/pg"
import {
	seedArtifact,
	seedGrant,
	seedProject,
	seedUser,
	seedWorkspace,
	softDeleteArtifact,
} from "@exagram/core/test/seed"
import { type SharingFixture, seedSharing } from "@exagram/core/test/sharing-fixtures"
import { createRouterClient } from "@orpc/server"
import postgres, { type Sql } from "postgres"
import { describe, expect, it } from "vitest"

import type { LiveEvent } from "@exagram/core/contract/events/type"
import type { ChangeFeed } from "@exagram/core/services/change-feed.port"

import { personalWorkspaceOf } from "../../test/personal-workspace"

import { createEventsRouter } from "./events.router"

import type { BaseContext } from "../plugins/context"

const WAIT_MS = 5_000
const RESYNC: LiveEvent = { topic: "resync", artifactId: null }

/** Polls `check` until it holds or the deadline passes; never an open-ended sleep. */
async function until(check: () => boolean, what: string, ms = WAIT_MS): Promise<void> {
	const deadline = Date.now() + ms
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

interface Harness {
	feed: ChangeFeed
	open: (userId: string, session?: { workspaceId?: string; sessionId?: string }) => Promise<Stream>
	close: () => Promise<void>
}

interface Stream {
	events: LiveEvent[]
	/** Resolves once an event matching `match` has arrived on this stream. */
	waitFor: (match: Partial<LiveEvent>) => Promise<void>
	flush: (workspaceId?: string) => Promise<void>
}

const matches = (event: LiveEvent, match: Partial<LiveEvent>) =>
	Object.entries(match).every(([key, value]) => event[key as keyof LiveEvent] === value)

/** The whole server path: real triggers, the Postgres ChangeFeedDeps, the ChangeFeed and the events router. */
async function startHarness(sql: Sql, fx: SharingFixture): Promise<Harness> {
	// One connection keeps reach queries (and so deliveries) in notice order; LISTEN has its own.
	const feedSql = postgres(pgUrl(), { max: 1, onnotice: () => {} })
	// No coalescing window (the unit tests cover it): a repeat event held back as a trailing delivery
	// would land after the flush marker and turn "nothing more arrived" into a race.
	const feed = await createChangeFeed(createPostgresChangeFeedDeps(feedSql), { coalesceMs: 0 })
	const shutdown = new AbortController()
	const router = createEventsRouter({ changeFeed: feed, shutdown: shutdown.signal })
	const users = new Map<string, { email: string }>([
		[fx.ownerId, { email: "owner@example.com" }],
		[fx.granteeId, { email: fx.granteeEmail }],
		[fx.outsiderId, { email: "outsider@example.com" }],
	])
	const pumps: Promise<void>[] = []

	const open = async (userId: string, session: { workspaceId?: string; sessionId?: string } = {}): Promise<Stream> => {
		const workspaceId = session.workspaceId ?? fx.workspaceId
		const user = {
			id: userId,
			sessionId: session.sessionId ?? randomUUID(),
			workspaceId,
			email: users.get(userId)?.email ?? "someone@example.com",
			name: "User",
			isAdmin: false,
			googleLinked: false,
			createdAt: new Date(),
		}
		const client = createRouterClient(router, {
			context: { headers: {}, requestId: `r-${userId}`, user, resHeaders: new Headers() } as unknown as BaseContext,
		})
		const iterator = await client.subscribe({})
		const events: LiveEvent[] = []
		pumps.push(
			(async () => {
				for await (const event of iterator) events.push(event)
			})(),
		)
		const waitFor = (match: Partial<LiveEvent>) =>
			until(() => events.some((e) => matches(e, match)), `${JSON.stringify(match)} for user ${userId}`)
		// The stream is subscribed before its first `resync` goes out, so nothing after this point is missed.
		await waitFor(RESYNC)

		const flush = async (inWorkspace = workspaceId) => {
			const markerId = await seedArtifact(sql, { workspaceId: inWorkspace, ownerId: userId, title: "control" })
			await waitFor({ topic: "artifact", artifactId: markerId })
		}
		return { events, waitFor, flush }
	}

	return {
		feed,
		open,
		close: async () => {
			shutdown.abort()
			await Promise.all(pumps)
			await feed.close()
			await feedSql.end()
		},
	}
}

let nextSeq = 3
/** A Revision published the way an upload publishes it (`publish_on_upload`), which moves the Current Revision. */
async function publishRevision(sql: Sql, fx: SharingFixture): Promise<void> {
	const seq = nextSeq++
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO exagram.revisions (artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
		VALUES (${fx.artifactId}, ${seq}, ${fx.ownerId}, ${`artifacts/v${seq}.md`}, 'text/markdown', 11, ${`sha-v${seq}`})
		RETURNING id`
	const published = await new RevisionsRepository(sql).publishOnUpload(row!.id, fx.ownerId)
	expect(published).toMatchObject({ status: "approved" })
}

const on = (fx: SharingFixture, topic: LiveEvent["topic"]): Partial<LiveEvent> => ({ topic, artifactId: fx.artifactId })
const count = (stream: Stream, match: Partial<LiveEvent>) => stream.events.filter((e) => matches(e, match)).length

describe("live events over the real change feed (integration)", () => {
	it("opens each stream with the workspace's quiet, which a committed change restarts", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const started = Date.now()
			const harness = await startHarness(sql, fx)
			try {
				const owner = await harness.open(fx.ownerId)
				const opening = owner.events[0]!
				expect(opening).toMatchObject(RESYNC)
				expect(opening.quietMs).toBeGreaterThanOrEqual(0)
				expect(opening.quietMs).toBeLessThanOrEqual(Date.now() - started)

				const beforeChange = Date.now()
				await owner.flush()
				const outsider = await harness.open(fx.outsiderId)
				expect(outsider.events[0]!.quietMs).toBeLessThanOrEqual(Date.now() - beforeChange)
			} finally {
				await harness.close()
			}
		})
	})

	it("sends current only to the workspace member who reaches the Artifact", async () => {
		await withDb(async (sql) => {
			nextSeq = 3
			const fx = await seedSharing(sql)
			const harness = await startHarness(sql, fx)
			try {
				const owner = await harness.open(fx.ownerId)
				const outsider = await harness.open(fx.outsiderId)

				await publishRevision(sql, fx)

				await owner.waitFor(on(fx, "current"))
				await outsider.flush()
				expect(outsider.events.filter((e) => e.artifactId === fx.artifactId)).toEqual([])
			} finally {
				await harness.close()
			}
		})
	})

	it("sends reach to a new Artifact grantee only, who then starts receiving current", async () => {
		await withDb(async (sql) => {
			nextSeq = 3
			const fx = await seedSharing(sql)
			const harness = await startHarness(sql, fx)
			try {
				const owner = await harness.open(fx.ownerId)
				const grantee = await harness.open(fx.granteeId)
				const outsider = await harness.open(fx.outsiderId)

				await publishRevision(sql, fx)
				await owner.waitFor(on(fx, "current"))
				await grantee.flush()
				expect(count(grantee, on(fx, "current"))).toBe(0)

				await seedGrant(sql, {
					artifactId: fx.artifactId,
					granteeId: fx.granteeId,
					role: "view",
					createdBy: fx.ownerId,
				})

				await grantee.waitFor(on(fx, "reach"))
				await owner.flush()
				await outsider.flush()
				expect(count(owner, on(fx, "reach"))).toBe(0)
				expect(count(outsider, on(fx, "reach"))).toBe(0)

				await publishRevision(sql, fx)
				await grantee.waitFor(on(fx, "current"))
			} finally {
				await harness.close()
			}
		})
	})

	it("sends reach when a Grant is removed mid-stream, and no current for that Artifact after", async () => {
		await withDb(async (sql) => {
			nextSeq = 3
			const fx = await seedSharing(sql)
			const grantId = await seedGrant(sql, {
				artifactId: fx.artifactId,
				granteeId: fx.granteeId,
				role: "view",
				createdBy: fx.ownerId,
			})
			const harness = await startHarness(sql, fx)
			try {
				const owner = await harness.open(fx.ownerId)
				const grantee = await harness.open(fx.granteeId)
				await publishRevision(sql, fx)
				await grantee.waitFor(on(fx, "current"))

				await sql`DELETE FROM exagram.grants WHERE id = ${grantId}`
				await grantee.waitFor(on(fx, "reach"))
				const currentBefore = count(grantee, on(fx, "current"))

				await publishRevision(sql, fx)
				await owner.waitFor(on(fx, "current"))
				await grantee.flush()
				expect(count(grantee, on(fx, "current"))).toBe(currentBefore)
			} finally {
				await harness.close()
			}
		})
	})

	it("sends removed to the Owner and the grantee on a soft-delete, and not to an outsider", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await seedGrant(sql, { artifactId: fx.artifactId, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			const harness = await startHarness(sql, fx)
			try {
				const owner = await harness.open(fx.ownerId)
				const grantee = await harness.open(fx.granteeId)
				const outsider = await harness.open(fx.outsiderId)

				await softDeleteArtifact(sql, fx.artifactId)

				await owner.waitFor(on(fx, "removed"))
				await grantee.waitFor(on(fx, "removed"))
				await outsider.flush()
				expect(count(outsider, on(fx, "removed"))).toBe(0)
			} finally {
				await harness.close()
			}
		})
	})

	it("tells a Project grantee when a move to another Project takes the Artifact out of their reach", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await seedGrant(sql, { projectId: fx.projectId, granteeId: fx.granteeId, role: "view", createdBy: fx.ownerId })
			const elsewhere = await seedProject(sql, { workspaceId: fx.workspaceId, ownerId: fx.ownerId, name: "Elsewhere" })
			const harness = await startHarness(sql, fx)
			try {
				const grantee = await harness.open(fx.granteeId)
				const outsider = await harness.open(fx.outsiderId)

				await sql`UPDATE exagram.artifacts SET project_id = ${elsewhere} WHERE id = ${fx.artifactId}`

				await grantee.waitFor(on(fx, "artifact"))
				await outsider.flush()
				expect(count(outsider, on(fx, "artifact"))).toBe(0)
				const [reach] = await sql<{ reaches: boolean }[]>`
					SELECT exagram.reaches_artifact(${fx.granteeId}::uuid, ${fx.artifactId}::uuid) AS reaches`
				expect(reach?.reaches).toBe(false)
			} finally {
				await harness.close()
			}
		})
	})
})

const seedSession = async (sql: Sql, userId: string, workspaceId: string) => {
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO exagram.sessions (user_id, token_hash, expires_at, workspace_id)
		VALUES (${userId}, ${randomUUID()}, now() + interval '1 hour', ${workspaceId})
		RETURNING id`
	return row!.id
}

describe("live events by the workspace a session acts in (integration)", () => {
	it("reaches a Guest in another workspace and the Owner in the Artifact's; a session switch moves the stream", async () => {
		await withDb(async (sql) => {
			nextSeq = 3
			const fx = await seedSharing(sql)
			const guestTeam = await seedWorkspace(sql, "Guest team")
			const guestId = await seedUser(sql, { workspaceId: guestTeam, email: "guest@example.com" })
			await seedGrant(sql, { artifactId: fx.artifactId, granteeId: guestId, role: "view", createdBy: fx.ownerId })
			const personal = { id: await personalWorkspaceOf(sql, fx.ownerId) }
			const sessionId = await seedSession(sql, fx.ownerId, fx.workspaceId)
			const harness = await startHarness(sql, fx)
			try {
				const guest = await harness.open(guestId, { workspaceId: guestTeam })
				const owner = await harness.open(fx.ownerId, { sessionId })
				const outsider = await harness.open(fx.outsiderId)

				await publishRevision(sql, fx)

				await owner.waitFor(on(fx, "current"))
				await guest.waitFor(on(fx, "revisions"))
				await guest.waitFor(on(fx, "current"))
				await outsider.flush()
				expect(count(outsider, on(fx, "current"))).toBe(0)

				const resyncs = count(owner, RESYNC)
				await sql`UPDATE exagram.sessions SET workspace_id = ${personal.id} WHERE id = ${sessionId}`
				await until(() => count(owner, RESYNC) > resyncs, "the resync at the switch")

				const ownerCurrents = count(owner, on(fx, "current"))
				const guestCurrents = count(guest, on(fx, "current"))
				await publishRevision(sql, fx)
				await until(() => count(guest, on(fx, "current")) > guestCurrents, "the Guest to hear the second Revision")
				await owner.flush(personal.id)
				expect(count(owner, on(fx, "current"))).toBe(ownerCurrents)

				const resyncsAway = count(owner, RESYNC)
				await sql`UPDATE exagram.sessions SET workspace_id = ${fx.workspaceId} WHERE id = ${sessionId}`
				await until(() => count(owner, RESYNC) > resyncsAway, "the resync at the switch back")
				await publishRevision(sql, fx)
				await until(() => count(owner, on(fx, "current")) > ownerCurrents, "the Owner to hear it again")
			} finally {
				await harness.close()
			}
		})
	})
})
