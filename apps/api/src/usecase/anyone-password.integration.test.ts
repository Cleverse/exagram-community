import { createHash, randomUUID } from "node:crypto"

import { verifyUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { withDb } from "@exagram/core/test/pg"
import { seedGrant, seedWorkspace } from "@exagram/core/test/seed"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"
import { describe, expect, it } from "vitest"

import { addMember } from "../../test/members"
import {
	startSessionApi,
	USERCONTENT_ORIGIN,
	USERCONTENT_SECRET,
	type ApiResponse,
	type SessionApi,
} from "../../test/sessionApi"

import type { Sql } from "postgres"

const PASSWORD = "correct horse battery"
const BODY = "hello from the Quarterly plan"
const GATE_MESSAGE = "Enter the password to open this file."
const EXPIRED_MESSAGE = "This link has expired. Ask the owner for a new one."
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

const inApi = (run: (sql: Sql, api: SessionApi) => Promise<void>): Promise<void> =>
	withDb(async (sql) => {
		const api = await startSessionApi(sql)
		try {
			await run(sql, api)
		} finally {
			await api.close()
		}
	})

/** Bo owns the file in Acme; Ada is a member of Acme; Carol belongs only to another Workspace. */
const people = async (sql: Sql, api: SessionApi) => {
	const signedUp = await api.auth.signUp({ email: "bo@acme.test", name: "Bo", password: PASSWORD })
	await api.teams.create(signedUp.user, "Acme")
	const bo = await api.auth.signIn({ email: "bo@acme.test", password: PASSWORD })
	const ada = await addMember(sql, api.auth, {
		workspaceId: bo.user.workspaceId,
		email: "ada@acme.test",
		name: "Ada",
		password: PASSWORD,
	})
	const otherWorkspaceId = await seedWorkspace(sql, "Other Co")
	const carol = await addMember(sql, api.auth, {
		workspaceId: otherWorkspaceId,
		email: "carol@other.test",
		name: "Carol",
		password: PASSWORD,
	})
	return {
		workspaceId: bo.user.workspaceId,
		bo: { id: bo.user.id, token: bo.token },
		ada: { id: ada.user.id, token: ada.token },
		carol: { id: carol.user.id, token: carol.token },
	}
}
type People = Awaited<ReturnType<typeof people>>

/** One approved doc Revision whose bytes the API can read back and verify. */
const seedDoc = async (sql: Sql, api: SessionApi, who: People, title = "Quarterly plan") => {
	const artifactId = randomUUID()
	const revisionId = randomUUID()
	const storageKey = `artifacts/${artifactId}/v1.md`
	api.storage.seed(storageKey, BODY)
	await sql`INSERT INTO exagram.artifacts (id, workspace_id, owner_id, kind, title)
		VALUES (${artifactId}, ${who.workspaceId}, ${who.bo.id}, 'doc', ${title})`
	await sql`INSERT INTO exagram.revisions (id, artifact_id, seq, author_user_id, storage_key, mime, bytes, sha256)
		VALUES (${revisionId}, ${artifactId}, 1, ${who.bo.id}, ${storageKey}, 'text/markdown', ${BODY.length}, ${sha256(BODY)})`
	await sql`SELECT exagram.approve_revision(${revisionId}::uuid, ${who.bo.id}::uuid)`
	return { artifactId, revisionId }
}

const patch = (api: SessionApi, token: string, path: string, body: unknown) =>
	api.call({ method: "PATCH", path, token, body })

const settings = (api: SessionApi, who: People, artifactId: string, body: unknown) =>
	patch(api, who.bo.token, `/v1/artifacts/${artifactId}/anyone-settings`, body)

/** Opens the file to Anyone with the link and puts the password on it. */
const protect = async (api: SessionApi, who: People, artifactId: string, extra: Record<string, unknown> = {}) => {
	const opened = await patch(api, who.bo.token, `/v1/artifacts/${artifactId}/general-access`, {
		generalAccess: "anyone",
	})
	expect(opened.status, opened.body).toBe(200)
	const set = await settings(api, who, artifactId, { passwordOn: true, password: PASSWORD, ...extra })
	expect(set.status, set.body).toBe(200)
}

const unlock = (api: SessionApi, artifactId: string, password: string, token?: string, ip?: string) =>
	api.call({ method: "POST", path: `/v1/artifacts/${artifactId}/unlock`, token, ip, body: { password } })

/** `name=value` of the cookie a response sets, the way a browser sends it back. */
const cookieOf = (response: ApiResponse): string => {
	const header = Array.isArray(response.setCookie) ? response.setCookie[0] : response.setCookie
	expect(header, "a Set-Cookie header").toBeDefined()
	return header!.split(";")[0]!
}

const read = (api: SessionApi, artifactId: string, who: { token?: string; cookies?: string[] } = {}) => ({
	artifact: () => api.call({ method: "GET", path: `/v1/artifacts/${artifactId}`, ...who }),
	text: () => api.call({ method: "GET", path: `/v1/artifacts/${artifactId}/text`, ...who }),
	bodyToken: () => api.call({ method: "POST", path: `/v1/${artifactId}/body-token`, ...who }),
	duplicate: () => api.call({ method: "POST", path: `/v1/artifacts/${artifactId}/duplicate`, ...who }),
	access: () => api.call({ method: "GET", path: `/v1/grants/access?artifactId=${artifactId}`, ...who }),
})

const gated = (response: ApiResponse) => {
	expect(response.status, response.body).toBe(403)
	expect(response.json).toMatchObject({ code: "PASSWORD_REQUIRED", message: GATE_MESSAGE })
	expect(response.cacheControl).toBe("no-store")
}

type ServeRow = { principalKind: string; action: string; outcome: string; reason: string | null }
const serves = (sql: Sql, artifactId: string) =>
	sql<ServeRow[]>`
		SELECT c.principal_kind AS "principalKind", c.action, s.outcome, s.reason
		FROM exagram.ledger_serves s JOIN exagram.ledger_calls c ON c.id = s.call_id
		WHERE s.artifact_id = ${artifactId}::uuid
		ORDER BY s.created_at, c.started_at`

const unlockRows = (sql: Sql, artifactId: string) =>
	sql<{ tokenHash: string; msLeft: number }[]>`
		SELECT token_hash AS "tokenHash", (extract(epoch FROM expires_at - now()) * 1000)::float8 AS "msLeft"
		FROM exagram.anyone_unlocks WHERE artifact_id = ${artifactId}::uuid`

const artifactCount = async (sql: Sql) =>
	(await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM exagram.artifacts`)[0]!.n

describe("Anyone with the link behind a password (integration)", () => {
	it("stops a signed-out reader at the lock, trades the password for a cookie, then lets the cookie read", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId, revisionId } = await seedDoc(sql, api, who)
			await protect(api, who, artifactId)

			const anonymous = read(api, artifactId)
			for (const response of [await anonymous.artifact(), await anonymous.text(), await anonymous.bodyToken()]) {
				gated(response)
				// A lock and nothing else: no title, no owner, no Workspace.
				expect(response.body).not.toContain("Quarterly plan")
				expect(response.body).not.toContain("Bo")
				expect(response.body).not.toContain("Acme")
			}
			expect((await serves(sql, artifactId)).map((row) => [row.principalKind, row.outcome, row.reason])).toEqual([
				["anonymous", "withheld", "password-required"],
				["anonymous", "withheld", "password-required"],
				["anonymous", "withheld", "password-required"],
			])

			const wrong = await unlock(api, artifactId, "wrong horse battery")
			expect(wrong.status, wrong.body).toBe(403)
			expect(wrong.json).toMatchObject({ code: "INCORRECT_PASSWORD", message: "Incorrect password. Try again." })
			expect(wrong.setCookie).toBeUndefined()
			expect(await unlockRows(sql, artifactId)).toHaveLength(0)

			const right = await unlock(api, artifactId, PASSWORD)
			expect(right.status, right.body).toBe(200)
			expect(right.json.result).toEqual({ unlocked: true })
			const header = String(right.setCookie)
			expect(header).toMatch(new RegExp(`^exagram_unlock_${artifactId}=[A-Za-z0-9_-]{43}; `))
			expect(header).toContain("Path=/v1;")
			expect(header).toContain("HttpOnly")
			expect(header).toContain("SameSite=Lax")
			expect(header).toContain("Max-Age=86400")
			const cookie = cookieOf(right)
			const value = cookie.split("=")[1]!

			const rows = await unlockRows(sql, artifactId)
			expect(rows).toHaveLength(1)
			expect(rows[0]!.tokenHash).toBe(sha256(value))
			expect(rows[0]!.msLeft).toBeGreaterThan(86_400_000 - 60_000)
			expect(rows[0]!.msLeft).toBeLessThanOrEqual(86_400_000)
			const [stored] = await sql<{ hash: string }[]>`
				SELECT anyone_password_hash AS hash FROM exagram.artifacts WHERE id = ${artifactId}::uuid`
			expect(stored!.hash).toMatch(/^\$argon2id\$/)
			expect(stored!.hash).not.toContain(PASSWORD)

			const unlocked = read(api, artifactId, { cookies: [cookie] })
			const opened = await unlocked.artifact()
			expect(opened.status, opened.body).toBe(200)
			expect(opened.json.result).toMatchObject({
				id: artifactId,
				title: "Quarterly plan",
				access: "view",
				canDownload: true,
				anyoneSettings: null,
			})
			const text = await unlocked.text()
			expect(text.status, text.body).toBe(200)
			expect(text.json.result).toMatchObject({ revisionId, text: BODY })
			const minted = await unlocked.bodyToken()
			expect(minted.status, minted.body).toBe(200)
			const token = (minted.json.result as { url: string }).url.replace(`${USERCONTENT_ORIGIN}/uc/`, "")
			expect(verifyUsercontentToken(token, USERCONTENT_SECRET)).toMatchObject({ ok: true, revisionId })
			const ledger = await serves(sql, artifactId)
			expect(ledger.filter((row) => row.action === "artifacts.unlock")).toEqual([
				{ principalKind: "anonymous", action: "artifacts.unlock", outcome: "withheld", reason: "incorrect-password" },
				{ principalKind: "anonymous", action: "artifacts.unlock", outcome: "served", reason: null },
			])
			expect(
				ledger
					.filter((row) => row.outcome === "served" && row.action !== "artifacts.unlock")
					.map((row) => [row.principalKind, row.action]),
			).toEqual([
				["anonymous", "artifacts.get"],
				["anonymous", "revisions.text"],
				["anonymous", "revisions.bodyToken"],
			])
		}))

	it("opens only the Artifact the cookie was earned for, and reads a forged or lapsed cookie as no cookie", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const first = await seedDoc(sql, api, who, "First")
			const second = await seedDoc(sql, api, who, "Second")
			await protect(api, who, first.artifactId)
			await protect(api, who, second.artifactId)

			const cookie = cookieOf(await unlock(api, first.artifactId, PASSWORD))
			expect((await read(api, first.artifactId, { cookies: [cookie] }).artifact()).status).toBe(200)

			const crossed = `exagram_unlock_${second.artifactId}=${cookie.split("=")[1]!}`
			gated(await read(api, second.artifactId, { cookies: [cookie] }).artifact())
			gated(await read(api, second.artifactId, { cookies: [crossed] }).artifact())
			gated(await read(api, first.artifactId, { cookies: [`exagram_unlock_${first.artifactId}=forged`] }).artifact())

			await sql`UPDATE exagram.anyone_unlocks SET expires_at = now() - interval '1 second'
				WHERE artifact_id = ${first.artifactId}::uuid`
			gated(await read(api, first.artifactId, { cookies: [cookie] }).artifact())
		}))

	it("gates a signed-in reader from another Workspace and a member of the Artifact's own the same way", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId } = await seedDoc(sql, api, who)
			await protect(api, who, artifactId)

			for (const reader of [who.carol, who.ada]) {
				gated(await read(api, artifactId, { token: reader.token }).artifact())
				gated(await read(api, artifactId, { token: reader.token }).text())
				const cookie = cookieOf(await unlock(api, artifactId, PASSWORD, reader.token))
				const opened = await read(api, artifactId, { token: reader.token, cookies: [cookie] }).artifact()
				expect(opened.status, opened.body).toBe(200)
				expect(opened.json.result).toMatchObject({ access: "view", anyoneSettings: null })
				expect(
					(await read(api, artifactId, { token: reader.token, cookies: [cookie] }).text()).json.result,
				).toMatchObject({ text: BODY })
			}
			expect((await serves(sql, artifactId)).filter((row) => row.reason === "password-required").length).toBe(4)
		}))

	it("shows a reader the access they hold only once their Unlock is known", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId } = await seedDoc(sql, api, who)
			await protect(api, who, artifactId)

			expect((await read(api, artifactId, { token: who.ada.token }).access()).json.result).toEqual({ access: null })
			const cookie = cookieOf(await unlock(api, artifactId, PASSWORD, who.ada.token))
			expect((await read(api, artifactId, { token: who.ada.token, cookies: [cookie] }).access()).json.result).toEqual({
				access: "view",
			})
		}))

	it("ends every Unlock when the Owner replaces the password, and only then", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId } = await seedDoc(sql, api, who)
			await protect(api, who, artifactId)
			const old = cookieOf(await unlock(api, artifactId, PASSWORD))
			const another = cookieOf(await unlock(api, artifactId, PASSWORD, who.ada.token))
			expect((await read(api, artifactId, { cookies: [old] }).artifact()).status).toBe(200)

			// Switching it off and on keeps the stored password, and so the Unlocks.
			await settings(api, who, artifactId, { passwordOn: false })
			await settings(api, who, artifactId, { passwordOn: true })
			expect((await read(api, artifactId, { cookies: [old] }).artifact()).status).toBe(200)
			expect(await unlockRows(sql, artifactId)).toHaveLength(2)

			const replaced = await settings(api, who, artifactId, { password: "a brand new password" })
			expect(replaced.status, replaced.body).toBe(200)
			expect(await unlockRows(sql, artifactId)).toHaveLength(0)
			gated(await read(api, artifactId, { cookies: [old] }).artifact())
			gated(await read(api, artifactId, { token: who.ada.token, cookies: [another] }).artifact())

			expect((await unlock(api, artifactId, PASSWORD)).json).toMatchObject({ code: "INCORRECT_PASSWORD" })
			const fresh = cookieOf(await unlock(api, artifactId, "a brand new password"))
			expect((await read(api, artifactId, { cookies: [fresh] }).artifact()).status).toBe(200)
		}))

	it("tells a reader the address expired, ahead of the password, and refuses to unlock it", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId } = await seedDoc(sql, api, who)
			await protect(api, who, artifactId)
			const cookie = cookieOf(await unlock(api, artifactId, PASSWORD))

			const set = await settings(api, who, artifactId, { expiresInDays: 7 })
			expect(set.status, set.body).toBe(200)
			const expiresAt = new Date(
				(set.json.result as { anyoneSettings: { expiresAt: string } }).anyoneSettings.expiresAt,
			)
			expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * 86_400_000 - 60_000)
			expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86_400_000)
			expect((await read(api, artifactId, { cookies: [cookie] }).artifact()).status).toBe(200)

			await sql`UPDATE exagram.artifacts SET anyone_expires_at = now() - interval '1 second' WHERE id = ${artifactId}::uuid`
			for (const reader of [{}, { cookies: [cookie] }, { token: who.carol.token }, { token: who.ada.token }]) {
				const response = await read(api, artifactId, reader).artifact()
				expect(response.status, response.body).toBe(410)
				expect(response.json).toMatchObject({ code: "ANYONE_EXPIRED", message: EXPIRED_MESSAGE })
				expect(response.cacheControl).toBe("no-store")
				expect(response.body).not.toContain("Quarterly plan")
			}
			expect((await read(api, artifactId).text()).status).toBe(410)
			expect((await read(api, artifactId).bodyToken()).status).toBe(410)
			expect((await serves(sql, artifactId)).some((row) => row.reason === "expired")).toBe(true)

			const refused = await unlock(api, artifactId, PASSWORD)
			expect(refused.status).toBe(404)
			expect(refused.json.message).toBe(REFUSAL_TEXT)

			// The Owner picks a new expiry, or none, and the same cookie reads again.
			await settings(api, who, artifactId, { expiresInDays: null })
			expect((await read(api, artifactId, { cookies: [cookie] }).artifact()).status).toBe(200)
		}))

	it("never gates the Owner or a Grant holder, whatever the Owner chose for everyone else", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId } = await seedDoc(sql, api, who)
			await protect(api, who, artifactId, { download: false })
			await seedGrant(sql, { artifactId, granteeId: who.ada.id, role: "view", createdBy: who.bo.id })

			for (const state of ["live", "expired"] as const) {
				if (state === "expired") {
					await sql`UPDATE exagram.artifacts SET anyone_expires_at = now() - interval '1 second'
						WHERE id = ${artifactId}::uuid`
				}
				const owner = await read(api, artifactId, { token: who.bo.token }).artifact()
				expect(owner.status, owner.body).toBe(200)
				expect(owner.json.result).toMatchObject({
					access: "owner",
					canDownload: true,
					anyoneSettings: { passwordOn: true, passwordSet: true, download: false },
				})
				const grantee = await read(api, artifactId, { token: who.ada.token }).artifact()
				expect(grantee.status, grantee.body).toBe(200)
				expect(grantee.json.result).toMatchObject({ canDownload: true, anyoneSettings: null })
				expect((await read(api, artifactId, { token: who.ada.token }).text()).json.result).toMatchObject({
					text: BODY,
				})
				const token = (
					(await read(api, artifactId, { token: who.ada.token }).bodyToken()).json.result as { url: string }
				).url.replace(`${USERCONTENT_ORIGIN}/uc/`, "")
				expect(verifyUsercontentToken(token, USERCONTENT_SECRET)).not.toHaveProperty("noDownload")
			}
		}))

	it("withholds download from an unlocked reader: the body token says so and a copy is refused", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId } = await seedDoc(sql, api, who)
			await protect(api, who, artifactId, { download: false })
			const cookie = cookieOf(await unlock(api, artifactId, PASSWORD, who.ada.token))
			const ada = read(api, artifactId, { token: who.ada.token, cookies: [cookie] })

			expect((await ada.artifact()).json.result).toMatchObject({ canDownload: false })
			const token = ((await ada.bodyToken()).json.result as { url: string }).url.replace(
				`${USERCONTENT_ORIGIN}/uc/`,
				"",
			)
			expect(verifyUsercontentToken(token, USERCONTENT_SECRET)).toMatchObject({ ok: true, noDownload: true })
			// Text kinds are read through revisions.text, which is how they are viewed.
			expect((await ada.text()).status).toBe(200)

			const before = await artifactCount(sql)
			const copy = await ada.duplicate()
			expect(copy.status).toBe(404)
			expect(copy.json.message).toBe(REFUSAL_TEXT)
			expect(await artifactCount(sql)).toBe(before)
			expect((await serves(sql, artifactId)).at(-1)).toMatchObject({
				action: "artifacts.duplicate",
				outcome: "withheld",
				reason: "refused-in-serve",
			})

			// With download allowed, the same Unlock copies the file into Ada's own Workspace.
			await settings(api, who, artifactId, { download: true })
			const allowed = await ada.duplicate()
			expect(allowed.status, allowed.body).toBe(200)
			expect(allowed.json.result).toMatchObject({ artifact: { ownerId: who.ada.id, title: "Quarterly plan (copy)" } })
			expect(await artifactCount(sql)).toBe(before + 1)
			const allowedToken = ((await ada.bodyToken()).json.result as { url: string }).url.replace(
				`${USERCONTENT_ORIGIN}/uc/`,
				"",
			)
			expect(verifyUsercontentToken(allowedToken, USERCONTENT_SECRET)).not.toHaveProperty("noDownload")
		}))

	it("lets only the Owner change the choices, shows them nothing secret, and needs a stored password to switch one on", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId } = await seedDoc(sql, api, who)

			for (const stranger of [who.ada.token, who.carol.token]) {
				const refused = await patch(api, stranger, `/v1/artifacts/${artifactId}/anyone-settings`, { download: false })
				expect(refused.status).toBe(404)
				expect(refused.json.message).toBe(REFUSAL_TEXT)
			}
			const [untouched] = await sql<{ download: boolean }[]>`
				SELECT anyone_download AS download FROM exagram.artifacts WHERE id = ${artifactId}::uuid`
			expect(untouched!.download).toBe(true)

			const early = await settings(api, who, artifactId, { passwordOn: true })
			expect(early.status).toBe(400)
			expect(early.json.message).toBe("Set a password first.")

			const set = await settings(api, who, artifactId, { passwordOn: true, password: PASSWORD, download: false })
			expect(set.status, set.body).toBe(200)
			expect((set.json.result as { anyoneSettings: unknown }).anyoneSettings).toEqual({
				passwordOn: true,
				passwordSet: true,
				expiresAt: null,
				download: false,
			})
			expect(set.body).not.toContain(PASSWORD)
			expect(set.body).not.toContain("argon2")

			const tooShort = await settings(api, who, artifactId, { password: "short" })
			expect(tooShort.status).toBe(400)
		}))

	it("refuses an unlock on a missing, restricted or passwordless Artifact as it refuses any unknown id", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const restricted = await seedDoc(sql, api, who, "Restricted")
			const open = await seedDoc(sql, api, who, "Open without a password")
			await patch(api, who.bo.token, `/v1/artifacts/${open.artifactId}/general-access`, { generalAccess: "anyone" })
			const stored = await seedDoc(sql, api, who, "Password kept but restricted")
			await protect(api, who, stored.artifactId)
			await patch(api, who.bo.token, `/v1/artifacts/${stored.artifactId}/general-access`, {
				generalAccess: "restricted",
			})

			const answers = [
				await unlock(api, randomUUID(), PASSWORD),
				await unlock(api, restricted.artifactId, PASSWORD),
				await unlock(api, open.artifactId, PASSWORD),
				await unlock(api, stored.artifactId, PASSWORD),
			]
			for (const answer of answers) {
				expect(answer.status).toBe(404)
				expect(answer.json.message).toBe(REFUSAL_TEXT)
				expect(answer.setCookie).toBeUndefined()
			}
			expect(new Set(answers.map((answer) => answer.body)).size).toBe(1)
			expect(await sql`SELECT 1 FROM exagram.anyone_unlocks`).toHaveLength(0)
		}))

	it("stops password guessing at ten a minute from one address, before it looks at the Artifact", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId } = await seedDoc(sql, api, who)
			await protect(api, who, artifactId)

			for (let attempt = 0; attempt < 10; attempt += 1) {
				expect((await unlock(api, artifactId, `wrong guess ${attempt}`)).status).toBe(403)
			}
			const blocked = await unlock(api, artifactId, PASSWORD)
			expect(blocked.status).toBe(429)
			expect(blocked.json.code).toBe("TOO_MANY_REQUESTS")
			expect(blocked.setCookie).toBeUndefined()
			expect(await unlockRows(sql, artifactId)).toHaveLength(0)

			// The budget comes first: an id nothing lives at is limited the same, not answered as not found.
			expect((await unlock(api, randomUUID(), PASSWORD)).status).toBe(429)
			// Another address is not limited by this one's tries.
			expect((await unlock(api, artifactId, PASSWORD, undefined, "198.51.100.7")).status).toBe(200)
		}))

	it("stops password guessing at thirty a minute at one Artifact however many addresses the tries come from", () =>
		inApi(async (sql, api) => {
			const who = await people(sql, api)
			const { artifactId } = await seedDoc(sql, api, who)
			await protect(api, who, artifactId)

			for (let attempt = 0; attempt < 30; attempt += 1) {
				const answered = await unlock(api, artifactId, `wrong guess ${attempt}`, undefined, `198.51.100.${attempt + 1}`)
				expect(answered.status).toBe(403)
			}
			const blocked = await unlock(api, artifactId, PASSWORD, undefined, "203.0.113.99")
			expect(blocked.status).toBe(429)
			expect(blocked.json.code).toBe("TOO_MANY_REQUESTS")
			expect(await unlockRows(sql, artifactId)).toHaveLength(0)
		}))
})
