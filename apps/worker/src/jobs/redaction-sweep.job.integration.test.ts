import { randomUUID } from "node:crypto"

import { withDb } from "@exagram/core/test/pg"
import { seedArtifact, seedProject, seedRevision, seedUser, seedWorkspace } from "@exagram/core/test/seed"
import { DETECTOR_VERSION } from "@exagram/redactor"
import { describe, expect, it } from "vitest"

import {
	REDACTION_MAX_ATTEMPTS,
	REDACTION_STALE_SECONDS,
	REDACTION_SWEEP_BATCH,
	REDACTION_SWEEP_CRON,
	REDACTION_SWEEP_QUEUE,
	createRedactionSweepHandler,
} from "./redaction-sweep.job"

import type { Sql } from "postgres"

const seedRevisionWith = async (sql: Sql, columns: Record<string, unknown>, kind: "doc" | "image" = "doc") => {
	const workspaceId = await seedWorkspace(sql)
	const ownerId = await seedUser(sql, { workspaceId, email: `${randomUUID()}@worker.test` })
	const projectId = await seedProject(sql, { workspaceId, ownerId, name: "p" })
	const artifactId = await seedArtifact(sql, { workspaceId, ownerId, projectId, title: "a", kind })
	const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
	if (Object.keys(columns).length > 0) {
		await sql`UPDATE "exagram"."revisions" SET ${sql(columns)} WHERE id = ${revisionId}`
	}
	return revisionId
}

describe("redaction sweep (integration)", () => {
	const sweep = async (sql: Sql, detectorVersion = DETECTOR_VERSION) => {
		const calls: string[] = []
		const enqueue = (id: string) => {
			calls.push(id)
			return Promise.resolve()
		}
		await createRedactionSweepHandler({ sql, enqueueRedact: enqueue, detectorVersion })()
		return calls
	}

	it("picks up a Revision that was never redacted", async () => {
		await withDb(async (sql) => {
			const id = await seedRevisionWith(sql, { redaction_status: "none" })
			expect(await sweep(sql)).toEqual([id])
		})
	})

	it("does not queue image revisions", async () => {
		await withDb(async (sql) => {
			const image = await seedRevisionWith(sql, { redaction_status: "none" }, "image")
			expect(await sweep(sql)).toEqual([])
			const [row] = await sql<{ redaction_status: string }[]>`
				SELECT redaction_status FROM "exagram"."revisions" WHERE id = ${image}
			`
			expect(row!.redaction_status).toBe("none")
		})
	})

	it("picks up a failed Revision with attempts left, and stops at the cap", async () => {
		await withDb(async (sql) => {
			const id = await seedRevisionWith(sql, { redaction_status: "failed", redaction_attempts: 1 })
			expect(await sweep(sql)).toEqual([id])
			await sql`
				UPDATE "exagram"."revisions" SET redaction_status = 'failed',
				redaction_attempts = ${REDACTION_MAX_ATTEMPTS} WHERE id = ${id}`
			expect(await sweep(sql)).toEqual([])
		})
	})

	it("picks up a Revision stuck queued longer than the stale window", async () => {
		await withDb(async (sql) => {
			const fresh = await seedRevisionWith(sql, { redaction_status: "queued", redaction_queued_at: new Date() })
			const stuck = await seedRevisionWith(sql, {
				redaction_status: "queued",
				redaction_queued_at: new Date(Date.now() - (REDACTION_STALE_SECONDS + 60) * 1000),
			})
			const swept = await sweep(sql)
			expect(swept).toContain(stuck)
			expect(swept).not.toContain(fresh)
		})
	})

	it("picks up a Revision redacted by an older detector", async () => {
		await withDb(async (sql) => {
			const old = await seedRevisionWith(sql, {
				redaction_status: "done",
				redacted_text: "x",
				redaction_detector_version: DETECTOR_VERSION - 1,
			})
			const current = await seedRevisionWith(sql, {
				redaction_status: "done",
				redacted_text: "x",
				redaction_detector_version: DETECTOR_VERSION,
			})
			const swept = await sweep(sql)
			expect(swept).toContain(old)
			expect(swept).not.toContain(current)
		})
	})

	it("wired with version 0, it never reclaims a done version-0 row", async () => {
		await withDb(async (sql) => {
			await seedRevisionWith(sql, { redaction_status: "done", redaction_detector_version: 0, redacted_text: "" })
			expect(await sweep(sql, 0)).toEqual([])
		})
	})

	it("wired with version 1, it reclaims a done version-0 row (an upgraded install re-detects)", async () => {
		await withDb(async (sql) => {
			const id = await seedRevisionWith(sql, {
				redaction_status: "done",
				redaction_detector_version: 0,
				redacted_text: "",
			})
			expect(await sweep(sql, 1)).toEqual([id])
		})
	})

	it("never picks up a too_large Revision: a newer detector does not shrink the body", async () => {
		await withDb(async (sql) => {
			await seedRevisionWith(sql, { redaction_status: "too_large" })
			expect(await sweep(sql)).toEqual([])
		})
	})

	it("fails an exhausted stale Revision before claiming and leaves a fresh one untouched", async () => {
		await withDb(async (sql) => {
			const exhausted = await seedRevisionWith(sql, {
				redaction_status: "queued",
				redaction_attempts: REDACTION_MAX_ATTEMPTS,
				redaction_queued_at: new Date(Date.now() - (REDACTION_STALE_SECONDS + 60) * 1000),
			})
			const fresh = await seedRevisionWith(sql, {
				redaction_status: "queued",
				redaction_attempts: REDACTION_MAX_ATTEMPTS,
				redaction_queued_at: new Date(),
			})

			expect(await sweep(sql)).toEqual([])

			const [exhaustedRow] = await sql<{ redaction_status: string }[]>`
				SELECT redaction_status FROM "exagram"."revisions" WHERE id = ${exhausted}
			`
			const [freshRow] = await sql<{ redaction_status: string }[]>`
				SELECT redaction_status FROM "exagram"."revisions" WHERE id = ${fresh}
			`
			expect(exhaustedRow!.redaction_status).toBe("failed")
			expect(freshRow!.redaction_status).toBe("queued")
		})
	})

	it("names its queue, its schedule and its batch size", () => {
		expect(REDACTION_SWEEP_QUEUE).toBe("exagram.redaction-sweep")
		expect(REDACTION_SWEEP_CRON).toBe("*/5 * * * *")
		expect(REDACTION_SWEEP_BATCH).toBe(500)
	})
})
