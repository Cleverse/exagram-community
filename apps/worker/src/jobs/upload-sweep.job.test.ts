import { describe, expect, it } from "vitest"

import type { Revision } from "@exagram/core/entity/revision"

import {
	UPLOAD_ORPHAN_MAX_AGE_SECONDS,
	UPLOAD_ORPHAN_SECONDS,
	UPLOAD_SWEEP_CRON,
	UPLOAD_SWEEP_QUEUE,
	UPLOAD_TEMP_ORPHAN_SECONDS,
	createUploadSweepHandler,
	type UploadSweepDeps,
} from "./upload-sweep.job"

const ARTIFACT = "11111111-1111-4111-8111-111111111111"
const orphan = `artifacts/${ARTIFACT}/orphan`
const settled = `artifacts/${ARTIFACT}/settled`
const broken = `artifacts/${ARTIFACT}/broken`
const MCP_BODY = "22222222-2222-4222-8222-222222222222"
const mcpOrphan = `${ARTIFACT}/${MCP_BODY}`
const MCP_DIR_SOURCE = `^${"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"}$`
const mcpSettled = `${ARTIFACT}/33333333-3333-4333-8333-333333333333`

function fakes(keys: string[], referenced: string[], rootKeys: string[] = []) {
	const calls: string[] = []
	const deps: UploadSweepDeps = {
		store: {
			async *listModifiedBetween(prefix, since, before) {
				calls.push(`list ${prefix} ${since.toISOString()} ${before.toISOString()}`)
				yield* await Promise.resolve(keys)
			},
			async *listRootModifiedBetween(dirName, since, before) {
				calls.push(`list-root ${since.toISOString()} ${before.toISOString()}`)
				yield* await Promise.resolve(rootKeys.filter((key) => dirName.test(key.split("/")[0] ?? "")))
			},
			delete(key) {
				calls.push(`delete ${key}`)
				return key === broken ? Promise.reject(new Error("EACCES")) : Promise.resolve()
			},
			deleteTempOlderThan(before) {
				calls.push(`temp ${before.toISOString()}`)
				return Promise.resolve(3)
			},
			deleteOrphanSidecarsOlderThan(dirName, before) {
				calls.push(`sidecars ${dirName.source === MCP_DIR_SOURCE} ${before.toISOString()}`)
				return Promise.resolve(2)
			},
		},
		revisions: {
			lockStorageKey(key) {
				calls.push(`lock ${key}`)
				return Promise.resolve()
			},
			getByStorageKey(artifactId, key) {
				calls.push(`get ${artifactId} ${key}`)
				return Promise.resolve(referenced.includes(key) ? ({ id: "r" } as Revision) : null)
			},
		},
		tx: {
			async atomic(fn) {
				calls.push("begin")
				const result = await fn()
				calls.push("commit")
				return result
			},
		},
	}
	return { deps, calls }
}

describe("upload sweep", () => {
	const now = new Date("2026-09-29T12:00:00.000Z")

	it("deletes day-old unreferenced bodies under the storage-key lock, and hour-old temp files", async () => {
		const { deps, calls } = fakes([orphan, settled], [settled])

		await createUploadSweepHandler(deps, () => now)()

		expect(calls).toEqual([
			"temp 2026-09-29T11:00:00.000Z",
			"sidecars true 2026-09-28T12:00:00.000Z",
			"list artifacts 2026-09-22T12:00:00.000Z 2026-09-28T12:00:00.000Z",
			"begin",
			`lock ${orphan}`,
			`get ${ARTIFACT} ${orphan}`,
			`delete ${orphan}`,
			"commit",
			"begin",
			`lock ${settled}`,
			`get ${ARTIFACT} ${settled}`,
			"commit",
			"list-root 2026-09-22T12:00:00.000Z 2026-09-28T12:00:00.000Z",
		])
	})

	it("skips keys no upload ticket could name without asking the database", async () => {
		const { deps, calls } = fakes(["artifacts/not-a-uuid/x", `artifacts/${ARTIFACT}/a/b`], [])

		await createUploadSweepHandler(deps, () => now)()

		expect(
			calls.filter((call) => !call.startsWith("temp") && !call.startsWith("sidecars") && !call.startsWith("list")),
		).toEqual([])
	})

	it("sweeps root-level MCP bodies the same way, and ignores root names of any other shape", async () => {
		const upper = `${"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase()}/${MCP_BODY}`
		const { deps, calls } = fakes(
			[],
			[mcpSettled],
			[mcpOrphan, mcpSettled, upper, `${ARTIFACT}/notes`, `${ARTIFACT}/${MCP_BODY}/extra`, "readme"],
		)

		await createUploadSweepHandler(deps, () => now)()

		expect(
			calls.filter((call) => !call.startsWith("temp") && !call.startsWith("sidecars") && !call.startsWith("list")),
		).toEqual([
			"begin",
			`lock ${mcpOrphan}`,
			`get ${ARTIFACT} ${mcpOrphan}`,
			`delete ${mcpOrphan}`,
			"commit",
			"begin",
			`lock ${mcpSettled}`,
			`get ${ARTIFACT} ${mcpSettled}`,
			"commit",
		])
	})

	it("keeps going after one key fails", async () => {
		const { deps, calls } = fakes([broken, orphan], [])

		await createUploadSweepHandler(deps, () => now)()

		expect(calls).toContain(`delete ${broken}`)
		expect(calls).toContain(`delete ${orphan}`)
	})

	it("names the queue and the hourly schedule", () => {
		expect(UPLOAD_SWEEP_QUEUE).toBe("exagram.upload-sweep")
		expect(UPLOAD_SWEEP_CRON).toBe("0 * * * *")
		expect(UPLOAD_ORPHAN_SECONDS).toBe(86_400)
		expect(UPLOAD_ORPHAN_MAX_AGE_SECONDS).toBe(604_800)
		expect(UPLOAD_TEMP_ORPHAN_SECONDS).toBe(3_600)
	})
})
