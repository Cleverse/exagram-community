import { randomUUID } from "node:crypto"

import { withDb } from "@exagram/core/test/pg"
import { seedMembership } from "@exagram/core/test/seed"
import { WORKSPACE_REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { addMember } from "../../../test/members"
import { personalWorkspaceOf } from "../../../test/personal-workspace"
import { startSessionApi, type ApiResponse, type SessionApi } from "../../../test/sessionApi"
import { signUpTeam } from "../../../test/team"

import type { Sql } from "postgres"

const PASSWORD = "correct horse battery"

const inApi = (run: (sql: Sql, api: SessionApi) => Promise<void>): Promise<void> =>
	withDb(async (sql) => {
		const api = await startSessionApi(sql)
		try {
			await run(sql, api)
		} finally {
			await api.close()
		}
	})

const resultOf = <T>(response: ApiResponse): T => {
	expect(response.status, response.body).toBeLessThan(300)
	return response.json.result as T
}

const insertWorkspace = async (sql: Sql, name: string, kind: "personal" | "team"): Promise<string> =>
	(
		await sql<{ id: string }[]>`
			INSERT INTO exagram.workspaces (name, kind, redaction, default_share_role, member_invites, link_preview)
			VALUES (
				${name}, ${kind}, ${kind === "personal" ? "off" : "on"}, ${kind === "personal" ? "view" : "collaborate"},
				${kind === "team"}, ${kind === "personal" ? "generic" : "metadata"}
			) RETURNING id`
	)[0]!.id

const people = async (sql: Sql, api: SessionApi) => {
	const bo = await signUpTeam(sql, api.auth, {
		email: "bo@acme.test",
		name: "Bo",
		password: PASSWORD,
		teamName: "Acme",
	})
	const teamId = bo.user.workspaceId
	const ada = await addMember(sql, api.auth, {
		workspaceId: teamId,
		email: "ada@acme.test",
		name: "Ada",
		password: PASSWORD,
	})
	const personalId = await personalWorkspaceOf(sql, ada.user.id)
	const boPersonalId = await personalWorkspaceOf(sql, bo.user.id)
	return {
		teamId,
		personalId,
		boPersonalId,
		bo: { id: bo.user.id, token: bo.token },
		ada: { id: ada.user.id, token: ada.token },
	}
}

const me = (api: SessionApi, token: string) => api.call({ method: "GET", path: "/v1/auth/me", token })

const switchTo = (api: SessionApi, token: string, workspaceId: string) =>
	api.call({ method: "POST", path: "/v1/auth/workspace", token, body: { workspaceId } })

const createFolder = async (api: SessionApi, token: string, name: string, parentProjectId: string | null = null) =>
	resultOf<{ id: string; workspaceId: string; parentProjectId: string | null }>(
		await api.call({ method: "POST", path: "/v1/projects", token, body: { name, parentProjectId } }),
	)

const createFile = async (api: SessionApi, token: string, title: string, projectId: string | null = null) =>
	resultOf<{ artifact: { id: string; workspaceId: string } }>(
		await api.call({
			method: "POST",
			path: "/v1/artifacts",
			token,
			body: { kind: "doc", title, projectId, mime: "text/markdown", bytes: 10 },
		}),
	).artifact

const titlesOf = (response: ApiResponse): string[] =>
	resultOf<{ items: { title?: string; name?: string }[] }>(response)
		.items.map((item) => item.title ?? item.name ?? "")
		.sort()

const workspaceOfArtifact = async (sql: Sql, artifactId: string): Promise<string> =>
	(
		await sql<
			{ workspaceId: string }[]
		>`SELECT workspace_id AS "workspaceId" FROM exagram.artifacts WHERE id = ${artifactId}`
	)[0]!.workspaceId

describe("the session's Workspace (integration)", () => {
	it("switches only the calling session to a Workspace the person is a member of, and answers Me for it", () =>
		inApi(async (sql, api) => {
			const p = await people(sql, api)
			const second = await api.auth.signIn({ email: "ada@acme.test", password: PASSWORD })
			const sessionBefore = await api.auth.resolveSession(p.ada.token)

			expect(resultOf(await me(api, p.ada.token))).toMatchObject({
				workspaceId: p.teamId,
				workspaceName: "Acme",
				workspaceKind: "team",
				isAdmin: false,
			})

			const switched = await switchTo(api, p.ada.token, p.personalId)

			expect(switched.status).toBe(200)
			expect(switched.setCookie).toBeUndefined()
			expect(switched.json.result).toMatchObject({
				id: p.ada.id,
				workspaceId: p.personalId,
				workspaceName: "Personal",
				workspaceKind: "personal",
				isAdmin: true,
				workspaces: [
					{ id: p.personalId, kind: "personal", name: "Personal", role: "admin" },
					{ id: p.teamId, kind: "team", name: "Acme", role: "member" },
				],
			})
			await expect(api.auth.resolveSession(p.ada.token)).resolves.toMatchObject({
				sessionId: sessionBefore!.sessionId,
				workspaceId: p.personalId,
				isAdmin: true,
			})
			expect(resultOf(await me(api, p.ada.token))).toMatchObject({ workspaceId: p.personalId, isAdmin: true })
			expect(resultOf(await me(api, second.token))).toMatchObject({ workspaceId: p.teamId, isAdmin: false })

			expect(resultOf(await switchTo(api, p.ada.token, p.teamId))).toMatchObject({
				workspaceId: p.teamId,
				workspaceKind: "team",
				isAdmin: false,
			})
		}))

	it("refuses a Workspace that is foreign, someone else's Personal, one they were removed from or only invited to, and an unknown id with one answer", () =>
		inApi(async (sql, api) => {
			const p = await people(sql, api)
			const foreign = await insertWorkspace(sql, "Elsewhere", "team")
			const othersPersonal = p.boPersonalId
			const removedFrom = await insertWorkspace(sql, "Left Co", "team")
			await seedMembership(sql, { userId: p.ada.id, workspaceId: removedFrom, removed: true })
			const invitedTo = await insertWorkspace(sql, "Invited Co", "team")
			await seedMembership(sql, { userId: p.ada.id, workspaceId: invitedTo, invited: true })
			const unknown = randomUUID()

			const refusals = [
				["a Workspace they are not in", foreign],
				["someone else's Personal Workspace", othersPersonal],
				["a Workspace they were removed from", removedFrom],
				["a Workspace they are only invited to", invitedTo],
				["an id no Workspace has", unknown],
			] as const
			const answers: { label: string; status: number; body: string }[] = []
			for (const [label, workspaceId] of refusals) {
				const refused = await switchTo(api, p.ada.token, workspaceId)
				answers.push({ label, status: refused.status, body: refused.body })
			}

			const [reference] = answers
			expect(reference!.status).toBe(404)
			expect(JSON.parse(reference!.body)).toMatchObject({ code: "NOT_FOUND", message: WORKSPACE_REFUSAL_TEXT })
			for (const answer of answers) {
				expect({ status: answer.status, body: answer.body }, answer.label).toEqual({
					status: reference!.status,
					body: reference!.body,
				})
			}
			expect(resultOf(await me(api, p.ada.token))).toMatchObject({ workspaceId: p.teamId })
			await expect(api.auth.resolveSession(p.ada.token)).resolves.toMatchObject({ workspaceId: p.teamId })
		}))

	it("answers me with exactly the shipped fields, and the Personal Workspace beside the one Team for a person in one Team", () =>
		inApi(async (sql, api) => {
			const p = await people(sql, api)

			const answer = await me(api, p.bo.token)

			const body = resultOf<Record<string, unknown>>(answer)
			expect(Object.keys(body).sort()).toEqual([
				"appleLinked",
				"createdAt",
				"email",
				"googleLinked",
				"id",
				"isAdmin",
				"name",
				"workspaceId",
				"workspaceKind",
				"workspaceName",
				"workspaces",
			])
			expect(body).toMatchObject({
				id: p.bo.id,
				workspaceId: p.teamId,
				email: "bo@acme.test",
				name: "Bo",
				isAdmin: true,
				googleLinked: false,
				appleLinked: false,
				workspaceName: "Acme",
				workspaceKind: "team",
			})
			expect(body.createdAt).toEqual(expect.any(String))
			expect(body.workspaces).toEqual([
				{ id: p.boPersonalId, kind: "personal", name: "Personal", role: "admin" },
				{ id: p.teamId, kind: "team", name: "Acme", role: "admin" },
			])
			expect(Object.keys((body.workspaces as object[])[0]!).sort()).toEqual(["id", "kind", "name", "role"])
		}))

	it("lists, searches and shows folders of the session's Workspace only, and a single read stays the person's", () =>
		inApi(async (sql, api) => {
			const p = await people(sql, api)
			await createFolder(api, p.ada.token, "Team plans")
			const teamFile = await createFile(api, p.ada.token, "Roadmap Team")
			await switchTo(api, p.ada.token, p.personalId)
			await createFolder(api, p.ada.token, "Personal plans")
			await createFile(api, p.ada.token, "Roadmap Personal")

			const inPersonal = async () => ({
				files: titlesOf(await api.call({ method: "GET", path: "/v1/artifacts", token: p.ada.token })),
				folders: titlesOf(await api.call({ method: "GET", path: "/v1/projects", token: p.ada.token })),
				search: titlesOf(await api.call({ method: "GET", path: "/v1/artifacts/search?q=roadmap", token: p.ada.token })),
			})

			expect(await inPersonal()).toEqual({
				files: ["Roadmap Personal"],
				folders: ["Personal plans"],
				search: ["Roadmap Personal"],
			})
			expect(
				resultOf(await api.call({ method: "GET", path: `/v1/artifacts/${teamFile.id}`, token: p.ada.token })),
			).toMatchObject({ id: teamFile.id, title: "Roadmap Team" })

			await switchTo(api, p.ada.token, p.teamId)
			expect(await inPersonal()).toEqual({
				files: ["Roadmap Team"],
				folders: ["Team plans"],
				search: ["Roadmap Team"],
			})
		}))

	it("files a new Artifact or subfolder in its folder's Workspace, a loose one in the session's, and refuses a move across Workspaces", () =>
		inApi(async (sql, api) => {
			const p = await people(sql, api)
			await switchTo(api, p.ada.token, p.personalId)
			const personalFolder = await createFolder(api, p.ada.token, "Personal plans")
			await switchTo(api, p.ada.token, p.teamId)

			const filed = await createFile(api, p.ada.token, "Notes", personalFolder.id)
			const loose = await createFile(api, p.ada.token, "Loose")
			const subfolder = await createFolder(api, p.ada.token, "Sub", personalFolder.id)
			const move = await api.call({
				method: "POST",
				path: `/v1/artifacts/${loose.id}/move`,
				token: p.ada.token,
				body: { projectId: personalFolder.id },
			})

			expect(await workspaceOfArtifact(sql, filed.id)).toBe(p.personalId)
			expect(await workspaceOfArtifact(sql, loose.id)).toBe(p.teamId)
			expect(subfolder).toMatchObject({ workspaceId: p.personalId, parentProjectId: personalFolder.id })
			expect(move.status).toBe(404)
			expect(move.json.message).toBe("Folder not found.")
			const [stillLoose] = await sql<{ projectId: string | null }[]>`
				SELECT project_id AS "projectId" FROM exagram.artifacts WHERE id = ${loose.id}`
			expect(stillLoose!.projectId).toBeNull()
		}))

	it("shows Audit only the reads of its own Workspace: a Team file's reads to the Team, a Personal file's to its owner", () =>
		inApi(async (sql, api) => {
			const p = await people(sql, api)
			const teamFile = await createFile(api, p.ada.token, "Team brief")
			await switchTo(api, p.ada.token, p.personalId)
			const personalFile = await createFile(api, p.ada.token, "Private draft")
			const read = (artifactId: string) =>
				api.call({ method: "GET", path: `/v1/artifacts/${artifactId}`, token: p.ada.token })
			const reads = async (token: string) =>
				resultOf<{ items: { action: string; artifactId: string }[] }>(
					await api.call({ method: "GET", path: "/v1/ledger/activity", token }),
				)
					.items.filter((item) => item.action === "artifacts.get")
					.map((item) => item.artifactId)
					.sort()

			await read(personalFile.id)
			await read(teamFile.id)
			await switchTo(api, p.ada.token, p.teamId)
			await read(teamFile.id)

			expect(await reads(p.bo.token)).toEqual([teamFile.id, teamFile.id])
			await switchTo(api, p.ada.token, p.personalId)
			expect(await reads(p.ada.token)).toEqual([personalFile.id, teamFile.id].sort())
		}))

	it("stops resolving a session whose Workspace the person has since left, and leaves their other sessions", () =>
		inApi(async (sql, api) => {
			const p = await people(sql, api)
			const inTeam = await api.auth.signIn({ email: "ada@acme.test", password: PASSWORD })
			await switchTo(api, p.ada.token, p.personalId)

			await seedMembership(sql, { userId: p.ada.id, workspaceId: p.teamId, removed: true })

			await expect(api.auth.resolveSession(inTeam.token)).resolves.toBeNull()
			await expect(api.auth.resolveSession(p.ada.token)).resolves.toMatchObject({ workspaceId: p.personalId })
		}))
})
