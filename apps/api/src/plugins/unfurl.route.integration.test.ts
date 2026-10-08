import { randomUUID } from "node:crypto"

import { TransactionProvider } from "@exagram/core/repository/postgres/db"
import { ProjectsRepository } from "@exagram/core/repository/postgres/projects.repository"
import { withDb } from "@exagram/core/test/pg"
import { seedArtifact, seedEmptyPersonalWorkspace, seedGrant, seedProject, seedUser } from "@exagram/core/test/seed"
import { seedSharing } from "@exagram/core/test/sharing-fixtures"
import { NotFoundError } from "@exagram/core/utils/errors"
import { fastify } from "fastify"
import { describe, expect, it } from "vitest"

import type { User } from "@exagram/core/entity/auth"

import { ProjectsUsecase } from "../usecase/projects/projects.usecase"

import { registerUnfurlRoute } from "./unfurl.route"

import type { Sql } from "postgres"

const WEB = "https://app.exagram.test"
const UNKNOWN_ID = "0f0e0d0c-0b0a-4908-8706-050403020100"

const buildApp = (sql: Sql, workspaceLabel = (name: string) => name) => {
	const app = fastify({ logger: false })
	registerUnfurlRoute(app, { sql, webOrigin: WEB, workspaceLabel })
	return app
}

const ogTitle = (body: string) => /<meta property="og:title" content="([^"]*)">/.exec(body)?.[1]

const userOf = (id: string, workspaceId: string): User => ({
	id,
	workspaceId,
	email: "x@example.com",
	name: "X",
	isAdmin: false,
	googleLinked: false,
	createdAt: new Date(),
})

describe("GET /v1/unfurl (integration)", () => {
	it("shows an Artifact's title, kind and workspace by default, and no body", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const app = buildApp(sql)
			const response = await app.inject({ method: "GET", url: `/v1/unfurl/artifacts/${fx.artifactId}` })

			expect(response.statusCode).toBe(200)
			expect(response.headers["content-type"]).toContain("text/html")
			expect(response.headers["content-security-policy"]).toBe(
				"default-src 'none'; base-uri 'none'; form-action 'none'",
			)
			expect(response.headers["x-content-type-options"]).toBe("nosniff")
			expect(response.headers["cache-control"]).toBe("private, max-age=60")
			expect(response.headers["vary"]).toBe("User-Agent")
			expect(ogTitle(response.body)).toBe("Quarterly plan")
			expect(response.body).toContain('<meta property="og:description" content="Doc · Acme">')
			expect(response.body).toContain('<meta property="og:site_name" content="Exagram">')
			expect(response.body).toContain('<meta property="og:type" content="website">')
			expect(response.body).toContain('<meta name="twitter:card" content="summary_large_image">')
			expect(response.body).toContain(`<meta property="og:image" content="${WEB}/og.png">`)
			expect(response.body).toContain(`<meta property="og:url" content="${WEB}/artifacts/${fx.artifactId}">`)
			expect(response.body).toContain(`<a href="${WEB}/artifacts/${fx.artifactId}">Quarterly plan</a>`)
			expect(response.body).not.toContain("http-equiv")
			// Nothing is ledgered and no view is claimed for a preview.
			const [ledger] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM exagram.ledger_calls`
			expect(ledger!.count).toBe(0)
			await app.close()
		})
	})

	it("shows the edition's label in place of the Workspace name", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const app = buildApp(sql, () => "Exagram")
			const response = await app.inject({ method: "GET", url: `/v1/unfurl/artifacts/${fx.artifactId}` })
			expect(response.body).toContain('<meta property="og:description" content="Doc · Exagram">')
			expect(response.body).not.toContain("Acme")
			await app.close()
		})
	})

	it("answers a Personal Artifact and folder with the one generic page, in a folder or not", async () => {
		await withDb(async (sql) => {
			const workspaceId = await seedEmptyPersonalWorkspace(sql)
			const ownerId = await seedUser(sql, { workspaceId, email: "solo@example.com" })
			const projectId = await seedProject(sql, { workspaceId, ownerId, name: "Notes" })
			const filed = await seedArtifact(sql, { workspaceId, ownerId, title: "Filed", projectId })
			const loose = await seedArtifact(sql, { workspaceId, ownerId, title: "Loose" })
			const app = buildApp(sql)
			const missing = await app.inject({ method: "GET", url: `/v1/unfurl/artifacts/${UNKNOWN_ID}` })
			for (const url of [
				`/v1/unfurl/artifacts/${filed}`,
				`/v1/unfurl/artifacts/${loose}`,
				`/v1/unfurl/projects/${projectId}`,
			]) {
				const response = await app.inject({ method: "GET", url })
				expect(response.statusCode).toBe(200)
				expect(response.body).toBe(missing.body)
			}
			await app.close()
		})
	})

	it("shows an Artifact outside any Project, and maps the kind label", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await sql`UPDATE exagram.artifacts SET project_id = NULL, kind = 'pptx' WHERE id = ${fx.artifactId}`
			const app = buildApp(sql)
			const response = await app.inject({ method: "GET", url: `/v1/unfurl/artifacts/${fx.artifactId}` })
			expect(ogTitle(response.body)).toBe("Quarterly plan")
			expect(response.body).toContain('content="PowerPoint · Acme"')
			await app.close()
		})
	})

	it("serves one generic page for a hidden, deleted, unknown or malformed id", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const app = buildApp(sql)
			const hiddenId = fx.artifactId
			await sql`UPDATE exagram.projects SET link_preview = 'generic' WHERE id = ${fx.projectId}`

			const deletedId = randomUUID()
			await sql`INSERT INTO exagram.artifacts (id, workspace_id, owner_id, project_id, kind, title, deleted_at)
				VALUES (${deletedId}, ${fx.workspaceId}, ${fx.ownerId}, NULL, 'doc', 'Deleted secret', now())`

			const paths = [
				`/v1/unfurl/artifacts/${hiddenId}`,
				`/v1/unfurl/artifacts/${deletedId}`,
				`/v1/unfurl/artifacts/${UNKNOWN_ID}`,
				"/v1/unfurl/artifacts/not-a-uuid%22%3E%3Cscript%3E",
				`/v1/unfurl/projects/${fx.projectId}`,
				`/v1/unfurl/projects/${UNKNOWN_ID}`,
				"/v1/unfurl/projects/nope",
			]
			const responses = await Promise.all(paths.map((url) => app.inject({ method: "GET", url })))
			for (const response of responses) {
				expect(response.statusCode).toBe(200)
				expect(response.headers["cache-control"]).toBe("private, max-age=60")
				expect(ogTitle(response.body)).toBe("Exagram")
				expect(response.body).toContain('content="A document shared on Exagram"')
				expect(response.body).not.toContain("Quarterly")
				expect(response.body).not.toContain("secret")
				expect(response.body).not.toContain("Acme")
			}
			// Byte-identical, malformed ids included: the page echoes nothing from the request.
			expect(new Set(responses.map((response) => response.body)).size).toBe(1)
			const headerShapes = responses.map((response) => JSON.stringify({ ...response.headers, date: undefined }))
			expect(new Set(headerShapes).size).toBe(1)
			const [first] = responses
			expect(first!.body).not.toContain("<script>")
			expect(first!.body).not.toContain("not-a-uuid")
			expect(first!.body).toContain(`<meta property="og:url" content="${WEB}/">`)
			await app.close()
		})
	})

	it("draws the generic page, byte for byte, for a gated Anyone-with-the-link address (ADR 0044)", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const app = buildApp(sql)
			const unfurl = (id: string) => app.inject({ method: "GET", url: `/v1/unfurl/artifacts/${id}` })
			const generic = (await unfurl(UNKNOWN_ID)).body
			const setAnyone = (columns: { access: string; password?: boolean; expiresAt?: string | null }) =>
				sql`UPDATE exagram.artifacts SET general_access = ${columns.access},
					anyone_password_hash = ${columns.password ? "hash" : null},
					anyone_password_on = ${columns.password ?? false},
					anyone_expires_at = ${columns.expiresAt ?? null}
				WHERE id = ${fx.artifactId}`

			await setAnyone({ access: "anyone" })
			expect(ogTitle((await unfurl(fx.artifactId)).body)).toBe("Quarterly plan")

			await setAnyone({ access: "anyone", expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
			expect(ogTitle((await unfurl(fx.artifactId)).body)).toBe("Quarterly plan")

			await setAnyone({ access: "anyone", password: true })
			expect((await unfurl(fx.artifactId)).body).toBe(generic)

			await setAnyone({ access: "anyone", expiresAt: new Date(Date.now() - 1000).toISOString() })
			expect((await unfurl(fx.artifactId)).body).toBe(generic)

			await setAnyone({ access: "anyone", password: true, expiresAt: new Date(Date.now() - 1000).toISOString() })
			expect((await unfurl(fx.artifactId)).body).toBe(generic)

			// The choices stay on an Artifact that is no longer open to anyone, and bind only that tier.
			await setAnyone({ access: "restricted", password: true, expiresAt: new Date(Date.now() - 1000).toISOString() })
			expect(ogTitle((await unfurl(fx.artifactId)).body)).toBe("Quarterly plan")
			await app.close()
		})
	})

	it("escapes a hostile title", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await sql`UPDATE exagram.artifacts SET title = ${'"><script>alert(1)</script>'} WHERE id = ${fx.artifactId}`
			const app = buildApp(sql)
			const response = await app.inject({ method: "GET", url: `/v1/unfurl/artifacts/${fx.artifactId}` })
			expect(response.body).not.toContain("<script>")
			expect(ogTitle(response.body)).toBe("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;")
			await app.close()
		})
	})

	it("shows a Project's name and workspace, and the generic page once the Owner hides it", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			const app = buildApp(sql)
			const url = `/v1/unfurl/projects/${fx.projectId}`

			const shown = await app.inject({ method: "GET", url })
			expect(ogTitle(shown.body)).toBe("P")
			expect(shown.body).toContain('content="Project · Acme"')
			expect(shown.body).toContain(`<a href="${WEB}/projects/${fx.projectId}">P</a>`)

			const projects = new ProjectsUsecase(new ProjectsRepository(sql), new TransactionProvider(sql))
			await projects.setLinkPreview(userOf(fx.ownerId, fx.workspaceId), {
				projectId: fx.projectId,
				linkPreview: "generic",
			})
			const hidden = await app.inject({ method: "GET", url })
			expect(ogTitle(hidden.body)).toBe("Exagram")
			const unknown = await app.inject({ method: "GET", url: `/v1/unfurl/projects/${UNKNOWN_ID}` })
			expect(hidden.body).toBe(unknown.body)

			// A child Project keeps its own value: hiding the parent does not hide it.
			const child = await app.inject({ method: "GET", url: `/v1/unfurl/projects/${fx.childProjectId}` })
			expect(ogTitle(child.body)).toBe("P child")
			await app.close()
		})
	})

	it("refuses anyone but the Owner a link preview change", async () => {
		await withDb(async (sql) => {
			const fx = await seedSharing(sql)
			await seedGrant(sql, {
				projectId: fx.projectId,
				granteeId: fx.granteeId,
				role: "collaborate",
				createdBy: fx.ownerId,
			})
			await seedGrant(sql, { projectId: fx.projectId, granteeId: fx.outsiderId, role: "edit", createdBy: fx.ownerId })
			const projects = new ProjectsUsecase(new ProjectsRepository(sql), new TransactionProvider(sql))

			for (const granteeId of [fx.granteeId, fx.outsiderId]) {
				await expect(
					projects.setLinkPreview(userOf(granteeId, fx.workspaceId), {
						projectId: fx.projectId,
						linkPreview: "generic",
					}),
				).rejects.toThrow(NotFoundError)
			}
			const [row] = await sql<{ linkPreview: string }[]>`
				SELECT link_preview AS "linkPreview" FROM exagram.projects WHERE id = ${fx.projectId}`
			expect(row!.linkPreview).toBe("metadata")
		})
	})
})
