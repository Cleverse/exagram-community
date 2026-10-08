import { McpRepository } from "@exagram/core/repository/postgres/mcp.repository"
import { withDb } from "@exagram/core/test/pg"
import {
	approveRevision,
	seedArtifact,
	seedConnection,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "@exagram/core/test/seed"
import { DETECTOR_VERSION, MIN_ACCEPTED_DETECTOR_VERSION } from "@exagram/redactor"
import { describe, expect, it } from "vitest"

import { McpToolsUsecase } from "../usecase/mcp-tools.usecase"

import type { Sql } from "postgres"

type Setting = "parent-on" | "parent-off" | "artifact-on" | "artifact-off"
type Status = "done" | "queued" | "failed" | "stale" | "too_large"

const KINDS = ["doc", "chat", "html", "pdf"] as const
const SETTINGS: Setting[] = ["parent-on", "parent-off", "artifact-on", "artifact-off"]
const STATUSES: Status[] = ["done", "queued", "failed", "stale", "too_large"]

const REDACTION_ON: Record<Setting, boolean> = {
	"parent-on": true,
	"parent-off": false,
	"artifact-on": true,
	"artifact-off": false,
}

async function seedReadable(sql: Sql, input: { kind: (typeof KINDS)[number]; setting: Setting; status: Status }) {
	const workspaceId = await seedWorkspace(sql)
	const ownerId = await seedUser(sql, { workspaceId, email: `owner-${input.kind}-${input.status}@example.test` })
	const parentProjectId = await seedProject(sql, { workspaceId, ownerId, name: `Parent-${input.setting}` })
	const projectId = await seedProject(sql, {
		workspaceId,
		ownerId,
		name: `Child-${input.setting}`,
		parentProjectId,
	})
	const artifactId = await seedArtifact(sql, {
		workspaceId,
		ownerId,
		projectId,
		title: `Quarterly ${input.kind}`,
		kind: input.kind,
	})
	const connectionId = await seedConnection(sql, { userId: ownerId })
	const revisionId = await seedRevision(sql, { artifactId, seq: 1, authorUserId: ownerId })
	await approveRevision(sql, artifactId, revisionId)

	const originalText = `quarterly needle mark.jones@acme.com`
	const redactedText = "quarterly needle [EMAIL]"
	const redactionStatus = input.status === "stale" ? "done" : input.status
	const detectorVersion =
		input.status === "stale" ? MIN_ACCEPTED_DETECTOR_VERSION - 1 : input.status === "done" ? DETECTOR_VERSION : null
	await sql`
		UPDATE "exagram"."projects"
		SET redaction = ${input.setting === "parent-on" || input.setting === "artifact-off" ? "on" : "off"}
		WHERE id = ${parentProjectId}::uuid
	`
	if (input.setting === "artifact-on" || input.setting === "artifact-off") {
		await sql`
			UPDATE "exagram"."artifacts"
			SET redaction = ${input.setting === "artifact-on" ? "on" : "off"}
			WHERE id = ${artifactId}::uuid
		`
	}
	await sql`
		UPDATE "exagram"."revisions"
		SET extracted_text = ${originalText},
			redacted_text = ${input.status === "done" || input.status === "stale" ? redactedText : null},
			redaction_status = ${redactionStatus},
			redaction_detector_version = ${detectorVersion}
		WHERE id = ${revisionId}::uuid
	`

	const bodies = new Map([[`artifacts/${artifactId}/1`, originalText]])
	const usecase = new McpToolsUsecase(new McpRepository(sql), {
		read: (storageKey) => Promise.resolve(bodies.get(storageKey) ?? ""),
		write: ({ storageKey, body }) => {
			bodies.set(storageKey, body)
			return Promise.resolve()
		},
		remove: (storageKey) => {
			bodies.delete(storageKey)
			return Promise.resolve()
		},
	})

	return {
		usecase,
		principal: { kind: "connection" as const, id: connectionId, folderAccess: "all" as const },
		artifactId,
		projectId,
		revisionId,
		originalText,
		redactedText,
		secretValue: "mark.jones@acme.com",
		async addPendingRevision(redacted: boolean) {
			const pendingId = await seedRevision(sql, {
				artifactId,
				seq: 2,
				authorUserId: ownerId,
				authorConnectionId: connectionId,
				status: "pending",
			})
			await sql`
				UPDATE "exagram"."revisions"
				SET extracted_text = ${originalText},
					redacted_text = ${redacted ? redactedText : null},
					redaction_status = ${redacted ? "done" : "queued"},
					redaction_detector_version = ${redacted ? DETECTOR_VERSION : null}
				WHERE id = ${pendingId}::uuid
			`
			return { revisionId: pendingId, seq: 2 }
		},
	}
}

describe("Connection reads under redaction (integration)", () => {
	for (const kind of KINDS) {
		for (const setting of SETTINGS) {
			for (const status of STATUSES) {
				it(`${kind} / ${setting} / ${status}`, async () => {
					await withDb(async (sql) => {
						const fixture = await seedReadable(sql, { kind, setting, status })
						const read = (await fixture.usecase.readArtifact(fixture.principal, fixture.artifactId)).artifact
						const listed = await fixture.usecase.listArtifacts(fixture.principal, { limit: 20 })
						const found = await fixture.usecase.searchArtifacts(fixture.principal, { query: "needle", limit: 20 })

						if (!REDACTION_ON[setting]) {
							expect(read?.body).toBe(fixture.originalText)
							expect(read?.form).toBe("original")
							return
						}
						if (status !== "done") {
							expect(read).toBeNull()
							expect(listed.map((row) => row.artifactId)).not.toContain(fixture.artifactId)
							expect(found.map((row) => row.artifactId)).not.toContain(fixture.artifactId)
							return
						}
						expect(read?.body).toBe(fixture.redactedText)
						expect(read?.form).toBe("redacted")
						expect(read?.body).not.toContain(fixture.secretValue)
						expect(found.map((row) => row.snippet).join(" ")).not.toContain(fixture.secretValue)
					})
				})
			}
		}
	}

	it("a Revision the null detector marked done (version 0, empty text) is Withheld in read, list and search", async () => {
		await withDb(async (sql) => {
			const fixture = await seedReadable(sql, { kind: "doc", setting: "parent-on", status: "done" })
			await sql`
				UPDATE "exagram"."revisions"
				SET redacted_text = '', redaction_detector_version = 0, placeholder_types = '{}'
				WHERE id = ${fixture.revisionId}::uuid
			`
			const read = (await fixture.usecase.readArtifact(fixture.principal, fixture.artifactId)).artifact
			const listed = await fixture.usecase.listArtifacts(fixture.principal, { limit: 20 })
			const found = await fixture.usecase.searchArtifacts(fixture.principal, { query: "needle", limit: 20 })
			expect(read).toBeNull()
			expect(listed.map((row) => row.artifactId)).not.toContain(fixture.artifactId)
			expect(found.map((row) => row.artifactId)).not.toContain(fixture.artifactId)
		})
	})

	it("accepts the current and previous detector versions, but not older text", async () => {
		await withDb(async (sql) => {
			const fixture = await seedReadable(sql, { kind: "doc", setting: "parent-on", status: "done" })
			await sql`
				UPDATE "exagram"."revisions"
				SET redaction_detector_version = ${MIN_ACCEPTED_DETECTOR_VERSION}
				WHERE id = ${fixture.revisionId}::uuid
			`
			expect((await fixture.usecase.readArtifact(fixture.principal, fixture.artifactId)).artifact).not.toBeNull()
			await sql`
				UPDATE "exagram"."revisions"
				SET redaction_detector_version = ${MIN_ACCEPTED_DETECTOR_VERSION - 1}
				WHERE id = ${fixture.revisionId}::uuid
			`
			expect((await fixture.usecase.readArtifact(fixture.principal, fixture.artifactId)).artifact).toBeNull()
		})
	})

	it("uses the new Project setting when an inheriting Artifact moves", async () => {
		await withDb(async (sql) => {
			const fixture = await seedReadable(sql, { kind: "doc", setting: "parent-off", status: "done" })
			expect((await fixture.usecase.readArtifact(fixture.principal, fixture.artifactId)).artifact?.form).toBe(
				"original",
			)
			await sql`UPDATE "exagram"."projects" SET redaction = 'on' WHERE id = ${fixture.projectId}::uuid`
			expect((await fixture.usecase.readArtifact(fixture.principal, fixture.artifactId)).artifact?.form).toBe(
				"redacted",
			)
		})
	})

	it("gates a Pending Revision reached through the authoring Connection", async () => {
		await withDb(async (sql) => {
			const fixture = await seedReadable(sql, { kind: "doc", setting: "parent-on", status: "done" })
			const pending = await fixture.addPendingRevision(true)
			const read = (await fixture.usecase.readArtifact(fixture.principal, fixture.artifactId, pending.seq)).artifact
			expect(read?.form).toBe("redacted")
			expect(read?.body).not.toContain(fixture.secretValue)
		})
	})

	it("applies redaction to current, latest and numbered Pending reads", async () => {
		await withDb(async (sql) => {
			const fixture = await seedReadable(sql, { kind: "doc", setting: "parent-on", status: "done" })
			const pending = await fixture.addPendingRevision(true)

			for (const selector of [undefined, "latest", 1, pending.seq] as const) {
				const read = (await fixture.usecase.readArtifact(fixture.principal, fixture.artifactId, selector)).artifact
				expect(read?.body).toBe(fixture.redactedText)
				expect(read?.form).toBe("redacted")
			}
		})
	})

	it("hides a Pending-only Artifact from list and search until its Redacted Text is ready", async () => {
		await withDb(async (sql) => {
			const workspaceId = await seedWorkspace(sql)
			const ownerId = await seedUser(sql, { workspaceId, email: `pending-only-${Date.now()}@example.test` })
			const projectId = await seedProject(sql, { workspaceId, ownerId, name: "Pending-only" })
			const artifactId = await seedArtifact(sql, {
				workspaceId,
				ownerId,
				projectId,
				title: "pending-only needle",
			})
			const connectionId = await seedConnection(sql, { userId: ownerId })
			const revisionId = await seedRevision(sql, {
				artifactId,
				seq: 1,
				authorUserId: ownerId,
				authorConnectionId: connectionId,
				status: "pending",
			})
			await sql`UPDATE exagram.projects SET redaction = 'on' WHERE id = ${projectId}::uuid`
			await sql`
				UPDATE exagram.revisions
				SET redaction_status = 'queued', extracted_text = 'pending-only needle'
				WHERE id = ${revisionId}::uuid
			`

			const usecase = new McpToolsUsecase(new McpRepository(sql), {
				read: () => Promise.resolve(""),
				write: async () => {},
				remove: async () => {},
			})
			const principal = { kind: "connection" as const, id: connectionId, folderAccess: "all" as const }
			expect((await usecase.listArtifacts(principal, { limit: 20 })).map((row) => row.artifactId)).not.toContain(
				artifactId,
			)
			expect(
				(await usecase.searchArtifacts(principal, { query: "pending-only", limit: 20 })).map((row) => row.artifactId),
			).not.toContain(artifactId)
		})
	})
})
